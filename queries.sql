-- Sample SQL queries for TrainSphere Learning Platform

-- 1. Get personalized course recommendations for a user based on their skills and role
SELECT 
  c.*,
  CASE 
    WHEN ucp.progress IS NULL THEN 0
    ELSE ucp.progress
  END as progress,
  CASE 
    WHEN ucp.status IS NULL THEN 'not_started'
    ELSE ucp.status
  END as status
FROM 
  courses c
LEFT JOIN 
  user_course_progress ucp ON c.id = ucp.course_id AND ucp.user_id = $1
CROSS JOIN 
  users u
WHERE 
  u.id = $1
  AND (ucp.dismissed IS NULL OR ucp.dismissed = FALSE)
  AND (ucp.progress IS NULL OR ucp.progress < 100)
  AND (c.recommended_roles @> JSONB_BUILD_ARRAY(u.role) 
       OR EXISTS (
         SELECT 1 
         FROM jsonb_array_elements_text(c.recommended_skills) skill
         WHERE u.skills ? skill AND (u.skills->>skill)::integer < 70
       ))
ORDER BY
  -- Higher priority for courses matching user's role
  (c.recommended_roles @> JSONB_BUILD_ARRAY(u.role))::integer DESC,
  -- Higher priority for courses addressing skill gaps
  (
    SELECT COUNT(1)
    FROM jsonb_array_elements_text(c.recommended_skills) skill
    WHERE u.skills ? skill AND (u.skills->>skill)::integer < 50
  ) DESC,
  -- Lower priority for courses already in progress (they'll still show up, but below new recommendations)
  (ucp.progress IS NULL)::integer DESC,
  c.created_at DESC
LIMIT $2;

-- 2. Get all courses with their completion status for a specific user
SELECT 
  c.*,
  COALESCE(ucp.progress, 0) as progress,
  COALESCE(ucp.status, 'not_started') as status,
  ucp.last_accessed_at,
  ucp.completed_at
FROM 
  courses c
LEFT JOIN 
  user_course_progress ucp ON c.id = ucp.course_id AND ucp.user_id = $1
ORDER BY
  CASE 
    WHEN ucp.status = 'in_progress' THEN 0
    WHEN ucp.status = 'completed' THEN 2
    ELSE 1
  END,
  ucp.last_accessed_at DESC NULLS LAST,
  c.title;

-- 3. Get training history with course details
SELECT 
  th.id,
  th.completed_at,
  th.score,
  th.certificate,
  c.id as course_id,
  c.title as course_title,
  c.category as course_category,
  c.duration as course_duration,
  c.instructor as course_instructor
FROM 
  training_history th
JOIN 
  courses c ON th.course_id = c.id
WHERE 
  th.user_id = $1
ORDER BY 
  th.completed_at DESC;

-- 4. Get skills gap analysis for a user
WITH user_skills AS (
  SELECT 
    u.id,
    jsonb_object_keys(u.skills) as skill_name,
    (u.skills->>jsonb_object_keys(u.skills))::integer as skill_value
  FROM 
    users u
  WHERE 
    u.id = $1
),
recommended_courses AS (
  SELECT 
    c.id,
    c.title,
    c.category,
    jsonb_array_elements_text(c.recommended_skills) as skill_name
  FROM 
    courses c
  LEFT JOIN
    user_course_progress ucp ON c.id = ucp.course_id AND ucp.user_id = $1
  WHERE
    (ucp.id IS NULL OR ucp.status != 'completed')
    AND (ucp.dismissed IS NULL OR ucp.dismissed = FALSE)
)
SELECT 
  us.skill_name,
  us.skill_value,
  ARRAY_AGG(rc.id) as recommended_course_ids,
  ARRAY_AGG(rc.title) as recommended_course_titles
FROM 
  user_skills us
LEFT JOIN 
  recommended_courses rc ON us.skill_name = rc.skill_name
WHERE 
  us.skill_value < 70
GROUP BY 
  us.skill_name, us.skill_value
ORDER BY 
  us.skill_value;

-- 5. Get popular courses based on enrollment and completion rates
SELECT 
  c.*,
  COUNT(DISTINCT ucp.user_id) as total_enrollments,
  SUM(CASE WHEN ucp.status = 'completed' THEN 1 ELSE 0 END) as completions,
  CASE
    WHEN COUNT(DISTINCT ucp.user_id) > 0 
    THEN ROUND((SUM(CASE WHEN ucp.status = 'completed' THEN 1 ELSE 0 END)::numeric / COUNT(DISTINCT ucp.user_id)) * 100)
    ELSE 0
  END as completion_rate
FROM 
  courses c
LEFT JOIN 
  user_course_progress ucp ON c.id = ucp.course_id
GROUP BY 
  c.id
ORDER BY 
  total_enrollments DESC,
  completion_rate DESC,
  c.created_at DESC
LIMIT 10;

-- 6. Update user skills after completing a course
-- This would be executed as part of a transaction when a course is marked as completed
WITH course_skills AS (
  SELECT 
    c.id,
    jsonb_array_elements_text(c.learning_outcomes) as skill
  FROM 
    courses c
  WHERE 
    c.id = $2
),
user_current_skills AS (
  SELECT 
    u.skills
  FROM 
    users u
  WHERE 
    u.id = $1
)
UPDATE users
SET skills = (
  SELECT 
    jsonb_object_agg(
      COALESCE(cs.skill, k),
      CASE
        -- If skill exists in course learning outcomes, increase by 10 (max 100)
        WHEN k = cs.skill THEN LEAST(100, (COALESCE((ucs.skills->>k)::integer, 0) + 10))
        -- Otherwise keep the same value
        ELSE (ucs.skills->>k)::integer
      END
    )
  FROM 
    user_current_skills ucs
  CROSS JOIN 
    jsonb_object_keys(ucs.skills) k
  LEFT JOIN 
    course_skills cs ON k = cs.skill
)
WHERE id = $1;

-- 7. Get comprehensive user activity report
SELECT 
  u.id,
  u.name,
  u.email,
  u.role,
  COUNT(DISTINCT ucp.course_id) as courses_enrolled,
  COUNT(DISTINCT CASE WHEN ucp.status = 'completed' THEN ucp.course_id END) as courses_completed,
  COUNT(DISTINCT CASE WHEN ucp.status = 'in_progress' THEN ucp.course_id END) as courses_in_progress,
  SUM(CASE WHEN ucp.status = 'completed' THEN c.duration ELSE 0 END) as total_training_minutes,
  MAX(ucp.last_accessed_at) as last_activity,
  jsonb_object_agg(
    c.category, 
    COUNT(DISTINCT ucp.course_id)
  ) FILTER (WHERE c.category IS NOT NULL) as category_distribution
FROM 
  users u
LEFT JOIN 
  user_course_progress ucp ON u.id = ucp.user_id
LEFT JOIN 
  courses c ON ucp.course_id = c.id
WHERE 
  u.id = $1
GROUP BY 
  u.id, u.name, u.email, u.role;
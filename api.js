// TrainSphere API Integration - Combined Client and Server APIs

// ==================== CLIENT-SIDE API FUNCTIONS ====================

/**
 * Function to handle API errors consistently
 * @param {any} error - The error object from a failed request
 * @returns {string} A user-friendly error message
 */
export const handleApiError = (error) => {
  if (error.response) {
    // Server responded with a status code outside the 2xx range
    if (error.response.data && error.response.data.message) {
      return error.response.data.message;
    }
    return `Error ${error.response.status}: ${error.response.statusText}`;
  } else if (error.request) {
    // Request was made but no response received
    return 'No response from server. Please check your connection.';
  } else {
    // Something else happened in setting up the request
    return error.message || 'An unknown error occurred';
  }
};

/**
 * Get course recommendations for the current user
 * @param {string} sortBy - How to sort the recommendations ('relevance' or 'newest')
 * @returns {Promise<Array>} Array of recommended courses with progress info
 */
export const getRecommendations = async (sortBy = 'relevance') => {
  try {
    const response = await fetch(`/api/recommendations?sortBy=${sortBy}`);
    if (!response.ok) {
      throw new Error(`Error ${response.status}: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Error fetching recommendations:', error);
    throw new Error(handleApiError(error));
  }
};

/**
 * Update a user's progress in a course
 * @param {number} courseId - The ID of the course
 * @param {number} progress - Progress percentage (0-100)
 * @returns {Promise<Object>} Updated progress object
 */
export const updateCourseProgress = async (courseId, progress) => {
  try {
    const response = await fetch(`/api/courses/${courseId}/progress`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ progress }),
    });
    
    if (!response.ok) {
      throw new Error(`Error ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // Invalidate relevant cache entries if using a cache (like React Query)
    if (typeof window !== 'undefined' && window.queryClient) {
      window.queryClient.invalidateQueries({ queryKey: ['/api/recommendations'] });
      window.queryClient.invalidateQueries({ queryKey: ['/api/courses'] });
      window.queryClient.invalidateQueries({ queryKey: [`/api/courses/${courseId}`] });
    }
    
    return data;
  } catch (error) {
    console.error('Error updating course progress:', error);
    throw new Error(handleApiError(error));
  }
};

/**
 * Dismiss a course recommendation
 * @param {number} courseId - The ID of the course to dismiss
 * @returns {Promise<Object>} API response
 */
export const dismissCourse = async (courseId) => {
  try {
    const response = await fetch(`/api/courses/${courseId}/dismiss`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    
    if (!response.ok) {
      throw new Error(`Error ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // Invalidate relevant cache entries if using a cache
    if (typeof window !== 'undefined' && window.queryClient) {
      window.queryClient.invalidateQueries({ queryKey: ['/api/recommendations'] });
    }
    
    return data;
  } catch (error) {
    console.error('Error dismissing course:', error);
    throw new Error(handleApiError(error));
  }
};

/**
 * Get the user's training history
 * @returns {Promise<Array>} Array of completed courses with details
 */
export const getTrainingHistory = async () => {
  try {
    const response = await fetch('/api/history');
    if (!response.ok) {
      throw new Error(`Error ${response.status}: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Error fetching training history:', error);
    throw new Error(handleApiError(error));
  }
};

/**
 * Get the user's skills data
 * @returns {Promise<Object>} User's skills and proficiency levels
 */
export const getSkills = async () => {
  try {
    const response = await fetch('/api/skills');
    if (!response.ok) {
      throw new Error(`Error ${response.status}: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Error fetching skills:', error);
    throw new Error(handleApiError(error));
  }
};

/**
 * Get details for a specific course
 * @param {number} courseId - The ID of the course
 * @returns {Promise<Object>} Course details
 */
export const getCourseDetails = async (courseId) => {
  try {
    const response = await fetch(`/api/courses/${courseId}`);
    if (!response.ok) {
      throw new Error(`Error ${response.status}: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Error fetching course details:', error);
    throw new Error(handleApiError(error));
  }
};

// ==================== SERVER-SIDE API HANDLERS ====================

/**
 * Get user by ID - SERVER HANDLER
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export async function getUserById(req, res) {
  try {
    const userId = Number(req.params.id);
    
    if (isNaN(userId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }
    
    // In a real app, this would query the database
    // Here using find() on mock data for demonstration
    const user = await db.select().from(users).where(eq(users.id, userId));
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    return res.json(user);
  } catch (error) {
    console.error('Error fetching user:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Get course recommendations for a user - SERVER HANDLER
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export async function getRecommendationsHandler(req, res) {
  try {
    const userId = Number(req.params.userId);
    const limit = Number(req.query.limit) || 10;
    const sortBy = req.query.sortBy || 'relevance';
    
    if (isNaN(userId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }
    
    // In a real app, this would perform complex queries
    // to find the most relevant courses for the user
    
    // Get user's skills to personalize recommendations
    const userSkills = await db.select().from(skills).where(eq(skills.userId, userId));
    
    // Get completed or dismissed courses
    const userProgress = await db.select()
      .from(userCourseProgress)
      .where(eq(userCourseProgress.userId, userId));
    
    const completedOrDismissedCourseIds = userProgress
      .filter(progress => progress.progress === 100 || progress.dismissed)
      .map(progress => progress.courseId);
    
    // Filter and sort courses
    let query = db.select().from(courses);
    
    // Exclude completed or dismissed courses
    if (completedOrDismissedCourseIds.length > 0) {
      query = query.where(
        sql`${courses.id} NOT IN (${completedOrDismissedCourseIds.join(',')})`
      );
    }
    
    // Apply sorting
    if (sortBy === 'newest') {
      query = query.orderBy(desc(courses.createdAt));
    } else {
      // Default relevance sorting logic would go here
      query = query.orderBy(asc(courses.title));
    }
    
    // Apply limit
    query = query.limit(limit);
    
    const recommendedCourses = await query;
    
    return res.json(recommendedCourses);
  } catch (error) {
    console.error('Error fetching recommendations:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Get all available courses - SERVER HANDLER
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export async function getAllCoursesHandler(req, res) {
  try {
    const allCourses = await db.select().from(courses);
    return res.json(allCourses);
  } catch (error) {
    console.error('Error fetching courses:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Get course by ID - SERVER HANDLER
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export async function getCourseByIdHandler(req, res) {
  try {
    const courseId = Number(req.params.id);
    
    if (isNaN(courseId)) {
      return res.status(400).json({ error: 'Invalid course ID' });
    }
    
    const course = await db.select().from(courses).where(eq(courses.id, courseId));
    
    if (!course || course.length === 0) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    return res.json(course[0]);
  } catch (error) {
    console.error('Error fetching course:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Update course progress - SERVER HANDLER
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export async function updateCourseProgressHandler(req, res) {
  try {
    const userId = Number(req.body.userId);
    const courseId = Number(req.params.id);
    const progress = Number(req.body.progress);
    
    if (isNaN(userId) || isNaN(courseId) || isNaN(progress)) {
      return res.status(400).json({ error: 'Invalid parameters' });
    }
    
    if (progress < 0 || progress > 100) {
      return res.status(400).json({ error: 'Progress must be between 0 and 100' });
    }
    
    // Check if the user and course exist
    const user = await db.select().from(users).where(eq(users.id, userId));
    if (!user || user.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const course = await db.select().from(courses).where(eq(courses.id, courseId));
    if (!course || course.length === 0) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    // Check if progress entry already exists
    const existingProgress = await db.select()
      .from(userCourseProgress)
      .where(and(
        eq(userCourseProgress.userId, userId),
        eq(userCourseProgress.courseId, courseId)
      ));
    
    let result;
    
    if (existingProgress && existingProgress.length > 0) {
      // Update existing progress
      result = await db.update(userCourseProgress)
        .set({ 
          progress, 
          lastUpdated: new Date(),
          status: progress === 100 ? 'completed' : 'in_progress',
          completedAt: progress === 100 ? new Date() : null
        })
        .where(eq(userCourseProgress.id, existingProgress[0].id))
        .returning();
    } else {
      // Create new progress entry
      result = await db.insert(userCourseProgress)
        .values({
          userId,
          courseId,
          progress,
          status: progress === 100 ? 'completed' : 'in_progress',
          dismissed: false,
          lastUpdated: new Date(),
          completedAt: progress === 100 ? new Date() : null
        })
        .returning();
    }
    
    // If progress is 100%, create a training history entry
    if (progress === 100 && (!existingProgress || existingProgress.length === 0 || existingProgress[0].progress < 100)) {
      await db.insert(trainingHistory)
        .values({
          userId,
          courseId,
          completedAt: new Date(),
          duration: course[0].duration,
          score: 100, // Default score, could be calculated based on quizzes
          certificate: true
        });
    }
    
    return res.json(result[0]);
  } catch (error) {
    console.error('Error updating course progress:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Dismiss a course - SERVER HANDLER
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export async function dismissCourseHandler(req, res) {
  try {
    const userId = Number(req.body.userId);
    const courseId = Number(req.params.id);
    
    if (isNaN(userId) || isNaN(courseId)) {
      return res.status(400).json({ error: 'Invalid parameters' });
    }
    
    // Verify the user and course exist
    const user = await db.select().from(users).where(eq(users.id, userId));
    if (!user || user.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const course = await db.select().from(courses).where(eq(courses.id, courseId));
    if (!course || course.length === 0) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    // Check if progress entry already exists
    const existingProgress = await db.select()
      .from(userCourseProgress)
      .where(and(
        eq(userCourseProgress.userId, userId),
        eq(userCourseProgress.courseId, courseId)
      ));
    
    let result;
    
    if (existingProgress && existingProgress.length > 0) {
      // Update existing progress to set dismissed flag
      result = await db.update(userCourseProgress)
        .set({ 
          dismissed: true, 
          lastUpdated: new Date() 
        })
        .where(eq(userCourseProgress.id, existingProgress[0].id))
        .returning();
    } else {
      // Create new progress entry with dismissed flag
      result = await db.insert(userCourseProgress)
        .values({
          userId,
          courseId,
          progress: 0,
          status: 'not_started',
          dismissed: true,
          lastUpdated: new Date()
        })
        .returning();
    }
    
    return res.json(result[0]);
  } catch (error) {
    console.error('Error dismissing course:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Get training history for a user - SERVER HANDLER
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export async function getTrainingHistoryHandler(req, res) {
  try {
    const userId = Number(req.params.userId);
    
    if (isNaN(userId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }
    
    // Get all training history entries for the user with course details
    const history = await db.select({
        id: trainingHistory.id,
        userId: trainingHistory.userId,
        courseId: trainingHistory.courseId,
        completedAt: trainingHistory.completedAt,
        score: trainingHistory.score,
        certificate: trainingHistory.certificate,
        courseTitle: courses.title,
        courseCategory: courses.category,
        courseDuration: courses.duration
      })
      .from(trainingHistory)
      .innerJoin(courses, eq(trainingHistory.courseId, courses.id))
      .where(eq(trainingHistory.userId, userId))
      .orderBy(desc(trainingHistory.completedAt));
    
    return res.json(history);
  } catch (error) {
    console.error('Error fetching training history:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Get skills for a user - SERVER HANDLER
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export async function getUserSkillsHandler(req, res) {
  try {
    const userId = Number(req.params.userId);
    
    if (isNaN(userId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }
    
    // In a database-driven app, this would query the skills table
    // For our demo, we'll access the skills from the user object
    const user = await db.select().from(users).where(eq(users.id, userId));
    
    if (!user || user.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    return res.json(user[0].skills);
  } catch (error) {
    console.error('Error fetching user skills:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// For server-side implementation:
// To use these handlers with Express:
/*
import express from 'express';
const app = express();

// User routes
app.get('/api/users/:id', getUserById);
app.get('/api/users/:userId/recommendations', getRecommendationsHandler);
app.get('/api/users/:userId/history', getTrainingHistoryHandler);
app.get('/api/users/:userId/skills', getUserSkillsHandler);

// Course routes
app.get('/api/courses', getAllCoursesHandler);
app.get('/api/courses/:id', getCourseByIdHandler);
app.post('/api/courses/:id/progress', updateCourseProgressHandler);
app.post('/api/courses/:id/dismiss', dismissCourseHandler);

// Simplified routes for demo app
app.get('/api/recommendations', (req, res) => {
  req.params.userId = 1; // Default user
  getRecommendationsHandler(req, res);
});

app.get('/api/history', (req, res) => {
  req.params.userId = 1; // Default user
  getTrainingHistoryHandler(req, res);
});

app.get('/api/skills', (req, res) => {
  req.params.userId = 1; // Default user
  getUserSkillsHandler(req, res);
});
*/
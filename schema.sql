-- Database Schema for TrainSphere Learning Platform

-- Users Table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL,
  skills JSONB NOT NULL,
  stats JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Courses Table
CREATE TABLE IF NOT EXISTS courses (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  instructor TEXT NOT NULL,
  category TEXT NOT NULL,
  duration INTEGER NOT NULL, -- in minutes
  image_path TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  modules JSONB NOT NULL,
  learning_outcomes JSONB NOT NULL,
  recommended_roles JSONB NOT NULL,
  recommended_skills JSONB NOT NULL,
  rating INTEGER DEFAULT 0,
  review_count INTEGER DEFAULT 0
);

-- User Course Progress Table
CREATE TABLE IF NOT EXISTS user_course_progress (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  progress INTEGER NOT NULL DEFAULT 0, -- percentage 0-100
  status TEXT NOT NULL DEFAULT 'not_started', -- not_started, in_progress, completed
  last_accessed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP WITH TIME ZONE,
  score INTEGER,
  dismissed BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE(user_id, course_id)
);

-- Training History Table
CREATE TABLE IF NOT EXISTS training_history (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  completed_at TIMESTAMP WITH TIME ZONE NOT NULL,
  duration INTEGER NOT NULL, -- in minutes
  score INTEGER NOT NULL,
  certificate BOOLEAN NOT NULL DEFAULT TRUE
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_user_course_progress_user_id ON user_course_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_user_course_progress_course_id ON user_course_progress(course_id);
CREATE INDEX IF NOT EXISTS idx_training_history_user_id ON training_history(user_id);
CREATE INDEX IF NOT EXISTS idx_courses_category ON courses(category);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- Comments explaining purpose of tables
COMMENT ON TABLE users IS 'Users of the TrainSphere platform including their roles and skills';
COMMENT ON TABLE courses IS 'Training courses available on the platform';
COMMENT ON TABLE user_course_progress IS 'Tracks user progress through courses including completion status';
COMMENT ON TABLE training_history IS 'Records of completed training for certification and history purposes';
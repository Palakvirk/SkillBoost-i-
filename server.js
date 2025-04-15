// Simple Node.js Express server for TrainSphere
const express = require('express');
const path = require('path');
const cors = require('cors');
const { Pool } = require('pg');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// Initialize Express app
const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configure PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/trainsphere',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Test database connection
pool.query('SELECT NOW()', (err) => {
  if (err) {
    console.error('Database connection error:', err);
  } else {
    console.log('Connected to PostgreSQL database');
  }
});

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    // Allow access for demo purposes, but in production, would require auth
    req.userId = 1; // Default user ID
    return next();
  }

  jwt.verify(token, process.env.JWT_SECRET || 'trainsphere_secret_key', (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token' });
    req.userId = user.id;
    next();
  });
};

// ------------- API ROUTES -------------

// Authentication routes
app.post('/api/register', async (req, res) => {
  try {
    const { username, password, name, email, role } = req.body;
    
    // Check if user already exists
    const userCheck = await pool.query(
      'SELECT * FROM users WHERE username = $1 OR email = $2',
      [username, email]
    );
    
    if (userCheck.rows.length > 0) {
      return res.status(400).json({ error: 'Username or email already exists' });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create new user
    const result = await pool.query(
      `INSERT INTO users (username, password, name, email, role, skills, stats) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, username, name, email, role`,
      [
        username, 
        hashedPassword, 
        name, 
        email, 
        role || 'user',
        JSON.stringify({ leadership: 10, data_analysis: 10, project_management: 10, communication: 10, technical: 10 }),
        JSON.stringify({ completed: 0, inProgress: 0, hours: 0 })
      ]
    );
    
    // Generate JWT
    const user = result.rows[0];
    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET || 'trainsphere_secret_key', { expiresIn: '7d' });
    
    res.status(201).json({ user, token });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Failed to register user' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Find user
    const result = await pool.query(
      'SELECT * FROM users WHERE username = $1',
      [username]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    
    const user = result.rows[0];
    
    // Check password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    
    // Generate JWT
    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET || 'trainsphere_secret_key', { expiresIn: '7d' });
    
    // Remove password from response
    delete user.password;
    
    res.json({ user, token });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Failed to log in' });
  }
});

// User routes
app.get('/api/user', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, name, email, role, skills, stats FROM users WHERE id = $1',
      [req.userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// Course recommendations
app.get('/api/recommendations', authenticateToken, async (req, res) => {
  try {
    const userId = req.userId;
    const sortBy = req.query.sortBy || 'relevance';
    const limit = parseInt(req.query.limit) || 10;
    
    // Get completed or dismissed courses
    const progressResult = await pool.query(
      `SELECT course_id FROM user_course_progress 
       WHERE user_id = $1 AND (progress = 100 OR dismissed = true)`,
      [userId]
    );
    
    const excludedCourseIds = progressResult.rows.map(row => row.course_id);
    
    // Construct the query
    let query = `
      SELECT c.*, 
             COALESCE(ucp.progress, 0) as progress,
             COALESCE(ucp.status, 'not_started') as status
      FROM courses c
      LEFT JOIN user_course_progress ucp ON c.id = ucp.course_id AND ucp.user_id = $1
      WHERE (ucp.dismissed IS NULL OR ucp.dismissed = false)
    `;
    
    if (excludedCourseIds.length > 0) {
      query += ` AND c.id NOT IN (${excludedCourseIds.join(',')})`;
    }
    
    if (sortBy === 'newest') {
      query += ` ORDER BY c.created_at DESC`;
    } else {
      query += ` ORDER BY c.title`; // Default relevance sorting
    }
    
    query += ` LIMIT $2`;
    
    const result = await pool.query(query, [userId, limit]);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching recommendations:', error);
    res.status(500).json({ error: 'Failed to fetch recommendations' });
  }
});

// Get all courses
app.get('/api/courses', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM courses ORDER BY title');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching courses:', error);
    res.status(500).json({ error: 'Failed to fetch courses' });
  }
});

// Get course by ID
app.get('/api/courses/:id', async (req, res) => {
  try {
    const courseId = parseInt(req.params.id);
    
    if (isNaN(courseId)) {
      return res.status(400).json({ error: 'Invalid course ID' });
    }
    
    const result = await pool.query(
      'SELECT * FROM courses WHERE id = $1',
      [courseId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching course:', error);
    res.status(500).json({ error: 'Failed to fetch course' });
  }
});

// Update course progress
app.post('/api/courses/:id/progress', authenticateToken, async (req, res) => {
  try {
    const courseId = parseInt(req.params.id);
    const userId = req.userId;
    const progress = parseInt(req.body.progress);
    
    if (isNaN(courseId) || isNaN(progress) || progress < 0 || progress > 100) {
      return res.status(400).json({ error: 'Invalid parameters' });
    }
    
    // Check if course exists
    const courseResult = await pool.query(
      'SELECT * FROM courses WHERE id = $1',
      [courseId]
    );
    
    if (courseResult.rows.length === 0) {
      return res.status(404).json({ error: 'Course not found' });
    }
    
    // Check if progress record exists
    const progressResult = await pool.query(
      'SELECT * FROM user_course_progress WHERE user_id = $1 AND course_id = $2',
      [userId, courseId]
    );
    
    const now = new Date();
    const status = progress === 100 ? 'completed' : (progress > 0 ? 'in_progress' : 'not_started');
    const completedAt = progress === 100 ? now : null;
    
    let result;
    
    if (progressResult.rows.length > 0) {
      // Update existing record
      result = await pool.query(
        `UPDATE user_course_progress 
         SET progress = $1, status = $2, last_accessed_at = $3, completed_at = $4
         WHERE user_id = $5 AND course_id = $6
         RETURNING *`,
        [progress, status, now, completedAt, userId, courseId]
      );
    } else {
      // Insert new record
      result = await pool.query(
        `INSERT INTO user_course_progress 
         (user_id, course_id, progress, status, last_accessed_at, completed_at, dismissed)
         VALUES ($1, $2, $3, $4, $5, $6, false)
         RETURNING *`,
        [userId, courseId, progress, status, now, completedAt]
      );
    }
    
    // If course is completed, add to training history
    if (progress === 100 && (progressResult.rows.length === 0 || progressResult.rows[0].progress < 100)) {
      await pool.query(
        `INSERT INTO training_history
         (user_id, course_id, completed_at, duration, score, certificate)
         VALUES ($1, $2, $3, $4, $5, true)`,
        [userId, courseId, now, courseResult.rows[0].duration, 100] // Default score for now
      );
      
      // Update user stats
      await pool.query(
        `UPDATE users
         SET stats = jsonb_set(
           jsonb_set(
             stats, 
             '{completed}', 
             ((stats->>'completed')::int + 1)::text::jsonb
           ),
           '{hours}',
           ((stats->>'hours')::int + $1)::text::jsonb
         )
         WHERE id = $2`,
        [Math.round(courseResult.rows[0].duration / 60), userId]
      );
    }
    
    // If this is a new in-progress course, update stats
    if (progress > 0 && progress < 100 && (progressResult.rows.length === 0 || progressResult.rows[0].progress === 0)) {
      await pool.query(
        `UPDATE users
         SET stats = jsonb_set(
           stats, 
           '{inProgress}', 
           ((stats->>'inProgress')::int + 1)::text::jsonb
         )
         WHERE id = $1`,
        [userId]
      );
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating progress:', error);
    res.status(500).json({ error: 'Failed to update progress' });
  }
});

// Dismiss course
app.post('/api/courses/:id/dismiss', authenticateToken, async (req, res) => {
  try {
    const courseId = parseInt(req.params.id);
    const userId = req.userId;
    
    if (isNaN(courseId)) {
      return res.status(400).json({ error: 'Invalid course ID' });
    }
    
    // Check if progress record exists
    const progressResult = await pool.query(
      'SELECT * FROM user_course_progress WHERE user_id = $1 AND course_id = $2',
      [userId, courseId]
    );
    
    const now = new Date();
    let result;
    
    if (progressResult.rows.length > 0) {
      // Update existing record
      result = await pool.query(
        `UPDATE user_course_progress 
         SET dismissed = true, last_accessed_at = $1
         WHERE user_id = $2 AND course_id = $3
         RETURNING *`,
        [now, userId, courseId]
      );
    } else {
      // Insert new record
      result = await pool.query(
        `INSERT INTO user_course_progress 
         (user_id, course_id, progress, status, last_accessed_at, dismissed)
         VALUES ($1, $2, 0, 'not_started', $3, true)
         RETURNING *`,
        [userId, courseId, now]
      );
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error dismissing course:', error);
    res.status(500).json({ error: 'Failed to dismiss course' });
  }
});

// Get training history
app.get('/api/history', authenticateToken, async (req, res) => {
  try {
    const userId = req.userId;
    
    const result = await pool.query(
      `SELECT th.*, c.title as course_title, c.category as course_category
       FROM training_history th
       JOIN courses c ON th.course_id = c.id
       WHERE th.user_id = $1
       ORDER BY th.completed_at DESC`,
      [userId]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching training history:', error);
    res.status(500).json({ error: 'Failed to fetch training history' });
  }
});

// Get user skills
app.get('/api/skills', authenticateToken, async (req, res) => {
  try {
    const userId = req.userId;
    
    const result = await pool.query(
      'SELECT skills FROM users WHERE id = $1',
      [userId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(result.rows[0].skills);
  } catch (error) {
    console.error('Error fetching skills:', error);
    res.status(500).json({ error: 'Failed to fetch skills' });
  }
});

// Initialize database (for first-time setup)
app.post('/api/init-db', async (req, res) => {
  try {
    // Check if tables exist
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'users'
      )
    `);
    
    if (tableCheck.rows[0].exists) {
      return res.json({ message: 'Database already initialized' });
    }
    
    // Create tables based on schema
    await pool.query(`
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
        duration INTEGER NOT NULL,
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
        progress INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'not_started',
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
        duration INTEGER NOT NULL,
        score INTEGER NOT NULL,
        certificate BOOLEAN NOT NULL DEFAULT TRUE
      );

      -- Create indexes
      CREATE INDEX IF NOT EXISTS idx_user_course_progress_user_id ON user_course_progress(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_course_progress_course_id ON user_course_progress(course_id);
      CREATE INDEX IF NOT EXISTS idx_training_history_user_id ON training_history(user_id);
      CREATE INDEX IF NOT EXISTS idx_courses_category ON courses(category);
      CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
    `);
    
    // Add a default user
    const hashedPassword = await bcrypt.hash('password123', 10);
    await pool.query(
      `INSERT INTO users (username, password, name, email, role, skills, stats) 
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        'alex', 
        hashedPassword, 
        'Alex Morgan', 
        'alex@example.com', 
        'manager',
        JSON.stringify({
          leadership: 75,
          data_analysis: 45,
          project_management: 60,
          communication: 80,
          technical: 50
        }),
        JSON.stringify({
          completed: 1,
          inProgress: 1,
          hours: 4
        })
      ]
    );
    
    // Add sample courses
    const sampleCourses = [
      {
        title: 'Data Analysis Fundamentals',
        description: 'Learn the essential skills of data analysis, including statistical methods and visualization techniques.',
        instructor: 'Dr. Sarah Johnson',
        category: 'Data Analysis',
        duration: 120,
        image_path: '/images/courses/data-analysis.jpg',
        modules: JSON.stringify([
          { title: 'Introduction to Data Analysis', duration: 20 },
          { title: 'Statistical Methods', duration: 40 },
          { title: 'Data Visualization', duration: 30 },
          { title: 'Analysis Tools and Software', duration: 30 }
        ]),
        learning_outcomes: JSON.stringify(['Statistical analysis', 'Data visualization', 'Critical thinking']),
        recommended_roles: JSON.stringify(['Analyst', 'Manager', 'Data Scientist']),
        recommended_skills: JSON.stringify(['Excel', 'Statistics', 'Critical Thinking'])
      },
      {
        title: 'Leadership Essentials',
        description: 'Develop key leadership skills needed to inspire and guide teams to success.',
        instructor: 'Michael Chen',
        category: 'Leadership',
        duration: 180,
        image_path: '/images/courses/leadership.jpg',
        modules: JSON.stringify([
          { title: 'Understanding Leadership Styles', duration: 45 },
          { title: 'Effective Communication', duration: 45 },
          { title: 'Team Building', duration: 45 },
          { title: 'Conflict Resolution', duration: 45 }
        ]),
        learning_outcomes: JSON.stringify(['Team management', 'Effective communication', 'Conflict resolution']),
        recommended_roles: JSON.stringify(['Manager', 'Team Lead', 'Director']),
        recommended_skills: JSON.stringify(['Communication', 'Empathy', 'Decision Making'])
      },
      {
        title: 'Project Management Fundamentals',
        description: 'Learn the core principles of project management including planning, execution, and closure.',
        instructor: 'Jessica Alvarez',
        category: 'Project Management',
        duration: 150,
        image_path: '/images/courses/project-management.jpg',
        modules: JSON.stringify([
          { title: 'Project Initiation', duration: 30 },
          { title: 'Project Planning', duration: 40 },
          { title: 'Project Execution', duration: 40 },
          { title: 'Project Monitoring', duration: 20 },
          { title: 'Project Closure', duration: 20 }
        ]),
        learning_outcomes: JSON.stringify(['Project planning', 'Risk management', 'Resource allocation']),
        recommended_roles: JSON.stringify(['Project Manager', 'Team Lead', 'Product Owner']),
        recommended_skills: JSON.stringify(['Organization', 'Time Management', 'Leadership'])
      },
      {
        title: 'Communication Skills for Professionals',
        description: 'Enhance your ability to communicate effectively in any professional environment.',
        instructor: 'Dr. Robert Martinez',
        category: 'Communication',
        duration: 90,
        image_path: '/images/courses/communication.jpg',
        modules: JSON.stringify([
          { title: 'Verbal Communication', duration: 30 },
          { title: 'Non-verbal Communication', duration: 20 },
          { title: 'Written Communication', duration: 20 },
          { title: 'Active Listening', duration: 20 }
        ]),
        learning_outcomes: JSON.stringify(['Clear articulation', 'Active listening', 'Persuasive writing']),
        recommended_roles: JSON.stringify(['All Roles']),
        recommended_skills: JSON.stringify(['Presentation', 'Writing', 'Listening'])
      }
    ];
    
    for (const course of sampleCourses) {
      await pool.query(
        `INSERT INTO courses (
          title, description, instructor, category, duration, image_path, 
          modules, learning_outcomes, recommended_roles, recommended_skills
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          course.title, course.description, course.instructor, course.category, 
          course.duration, course.image_path, course.modules, course.learning_outcomes,
          course.recommended_roles, course.recommended_skills
        ]
      );
    }
    
    // Add sample progress and history
    await pool.query(
      `INSERT INTO user_course_progress 
       (user_id, course_id, progress, status, last_accessed_at) 
       VALUES (1, 2, 45, 'in_progress', NOW())`
    );
    
    await pool.query(
      `INSERT INTO training_history 
       (user_id, course_id, completed_at, duration, score, certificate) 
       VALUES (1, 4, NOW() - INTERVAL '3 months', 90, 95, true)`
    );
    
    res.json({ message: 'Database initialized successfully' });
  } catch (error) {
    console.error('Error initializing database:', error);
    res.status(500).json({ error: 'Failed to initialize database' });
  }
});

// Catch all API routes that weren't matched
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found' });
});

// Serve the frontend for any other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
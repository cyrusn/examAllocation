const { GENERAL_DUTIES } = require('./constants')

module.exports = {
  // Default number of invigilators if no rule matches and spreadsheet is empty
  DEFAULT_INVIGILATOR_COUNT: 1,

  /**
   * Rules to determine invigilator count automatically.
   * The system checks these rules in order. The first one that returns true wins.
   * 
   * Available properties on 'exam':
   * - classlevel (e.g., 'S1', 'G', 'SB')
   * - classcode (e.g., '1Chin', 'G-1')
   * - title (e.g., 'Chinese Language', 'Guidance Duty')
   * - location (e.g., 'HALL', '201')
   * - session (e.g., 1, 2)
   */
  INVIGILATOR_RULES: [
    // --- SEN Exams ---
    {
      // Match SEN exams based on class code (e.g., 1SR, 2ST)
      match: (exam) => /\d{1}S(R|T)?/.test(exam.classcode),
      count: 2
    },

    // --- Hall Rules ---
    { 
      // Hall exams for Junior forms (S1-S3, usually classes A-D)
      match: (exam) => exam.location === 'HALL' && /[1-3]/.test(exam.classlevel), 
      count: 4
    },
    { 
      // Hall exams for Senior forms (S4-S6, usually classes A-E)
      match: (exam) => exam.location === 'HALL' && /[4-6]/.test(exam.classlevel), 
      count: 5
    },

    // --- General Duties ---
    { 
      // All General Duties (G, SB) default to 1
      match: (exam) => GENERAL_DUTIES.includes(exam.classlevel), 
      count: 1 
    },

    // --- Location Based Rules ---
    { 
      match: (exam) => exam.location === 'HALL', 
      count: 3 // Fallback for other Hall exams
    },
    { 
      match: (exam) => ['Gym', 'Covered Playground'].includes(exam.location), 
      count: 2 
    },

    // --- Specific Subjects ---
    // Example: S1 Math needs 2 invigilators
    // { 
    //   match: (exam) => exam.classlevel === 'S1' && exam.title.toUpperCase().includes('MATH'), 
    //   count: 2 
    // },
  ]
}

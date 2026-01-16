const _ = require('lodash')
const {
  GENERAL_DUTIES,
  TEACHER_ASSISTANTS,
  DC_TEAM_MEMBERS,
  PREFERED_RATE
} = require('../constants')
const { getExamInterval, getSenDuration } = require('../utils')
const {
  checkOverlapWithUnavailable,
  isTeacherAssignedTimeConflict,
  getTeacherAssignedExamsOnSameDay,
  getPeriodLessonCount,
  getDayLessonsCount
} = require('./common')

/**
 * Calculates the impact of an exam on a teacher's load.
 */
function calculateExamImpact(exam) {
  const senDuration = getSenDuration(exam)
  const isSen = /\d{1}S(R|T)?/.test(exam.classcode)
  const duration = isSen ? senDuration : exam.duration

  let timeAdded = duration
  let generalDuty = 0
  let senDuty = 0
  
  if (GENERAL_DUTIES.includes(exam.classlevel)) {
    generalDuty = 1
    if (exam.classlevel === 'G') timeAdded = 30
  }

  if (isSen) {
    senDuty = 1
  }

  return { timeAdded, generalDuty, senDuty, session: exam.session, startDateTime: exam.startDateTime, location: exam.location }
}

/**
 * Updates a teacher object with a new exam assignment.
 * Returns a new teacher object (pure).
 */
function assignExamToTeacher(teacher, exam) {
  const impact = calculateExamImpact(exam)
  const { timeAdded, generalDuty, senDuty, session, startDateTime, location } = impact
  
  const newTeacher = { ...teacher, exams: [...(teacher.exams || [])] }
  
  // Check for duplicate assignment (same session/loc/day)
  const isDuplicate = newTeacher.exams.some(e => 
    e.session == session &&
    e.location == location &&
    e.startDateTime.slice(0, 10) == startDateTime.slice(0, 10)
  )

  if (isDuplicate) return teacher

  newTeacher.occurrence = (newTeacher.occurrence || 0) + 1
  newTeacher.totalInvigilationTime = (newTeacher.totalInvigilationTime || 0) + timeAdded
  newTeacher.generalDuty = (newTeacher.generalDuty || 0) + generalDuty
  newTeacher.senDuty = (newTeacher.senDuty || 0) + senDuty
  
  newTeacher.exams.push(impact)
  
  return newTeacher
}

/**
 * Returns a sorted list of available teachers for a given exam.
 */
function getOrderedAvailableTeachers(
  teachers,
  unavailableArrays,
  assignedExaminations,
  exam,
  options = { strict: true }
) {
  const { classlevel, classcode, preferedTeachers } = exam
  const examInterval = getExamInterval(exam)
  const isSen = /\d{1}S(R|T)?/.test(classcode)
  const { strict } = options

  const candidates = teachers.filter(t => {
    // 1. Hard Constraints (Physical Impossibilities)
    if (t.isSkip) return false
    
    // Check Unavailable Slots
    if (checkOverlapWithUnavailable(t.teacher, examInterval, unavailableArrays)) return false

    // Check Time Conflicts with Assigned Exams
    if (isTeacherAssignedTimeConflict(t.teacher, examInterval, assignedExaminations)) return false

    // Role Exclusions (e.g., TAs don't do General Duties)
    const isTaOrDc = [...TEACHER_ASSISTANTS, ...DC_TEAM_MEMBERS].includes(t.teacher)
    if (GENERAL_DUTIES.includes(classlevel) && isTaOrDc) return false

    // 2. Soft Constraints (Relaxable)
    if (strict) {
       if (t.maxLoading && t.maxLoading <= t.occurrence) return false
       
       const assignedOnDay = getTeacherAssignedExamsOnSameDay(t.teacher, exam, assignedExaminations)
       if (assignedOnDay.length > 2) return false // Limit: >2 exams/day

       const lessonsOnDay = getDayLessonsCount(t.teacher, exam, unavailableArrays)
       if (lessonsOnDay > 4) return false // Limit: >4 lessons/day
    }

    return true
  })

  // Sorting Logic
  const sortFunction = (t) => {
       const lessonCount = getPeriodLessonCount(t.teacher, exam, unavailableArrays)
       let score = (t.totalInvigilationTime + lessonCount * 55) / 120
       
       if (preferedTeachers && preferedTeachers.includes(t.teacher)) {
         score = Math.round(score * PREFERED_RATE)
       } else {
         score = Math.round(score)
       }
       return score
  }

  // Sorting Priorities
  if ([...GENERAL_DUTIES, 'FI'].includes(classlevel)) {
    return _.orderBy(
      candidates,
      ['generalDuty', sortFunction, 'occurrence'],
      ['asc', 'asc', 'asc']
    )
  }

  if (isSen) {
    return _.orderBy(
      candidates,
      ['senDuty', sortFunction, 'occurrence'],
      ['asc', 'asc', 'asc']
    )
  }

  return _.orderBy(candidates, [
    sortFunction,
    'occurrence',
    'generalDuty'
  ], ['asc', 'asc', 'asc'])
}

/**
 * Calculates final stats for all teachers based on assignments.
 */
function calculateTeacherStats(teachers, assignedExaminations) {
  let currentTeachers = teachers.map(t => ({...t, exams: []}))

  assignedExaminations.forEach(exam => {
    exam.invigilators.forEach(invigilator => {
       if (invigilator === 'UNASSIGNED') return

       const teacherIndex = currentTeachers.findIndex(t => t.teacher === invigilator)
       if (teacherIndex !== -1) {
         currentTeachers[teacherIndex] = assignExamToTeacher(currentTeachers[teacherIndex], exam)
       } else {
         const newT = assignExamToTeacher({ teacher: invigilator, exams: [], totalInvigilationTime: 0, generalDuty: 0, occurrence: 0 }, exam)
         currentTeachers.push(newT)
       }
    })
  })
  return currentTeachers
}

module.exports = {
  assignExamToTeacher,
  getOrderedAvailableTeachers,
  calculateTeacherStats,
  calculateExamImpact
}

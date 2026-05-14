const _ = require('lodash')
const { DateTime } = require('luxon')
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

  // Use the duration if it's a valid number (even if originally NA, it might have been set to sbDuration in parser)
  let timeAdded = (isNaN(duration) || duration === undefined) ? 0 : duration
  let fiDuty = 0
  let sbDuty = 0
  let guidanceDuty = 0
  let senDuty = 0
  
  if (exam.isStandby || exam.classlevel === 'SB') {
    timeAdded = 0
    sbDuty = 1
  } else if (exam.isGuidance || exam.isMorning || exam.classlevel === 'G') {
    timeAdded = 60
    guidanceDuty = 1
    if (exam.classlevel === 'G' && !exam.isDurationNA) timeAdded = 30
  } else if (exam.isFI || exam.classlevel === 'FI') {
    fiDuty = 1
  }

  if (isSen) {
    senDuty = 1
  }

  return { timeAdded, fiDuty, sbDuty, guidanceDuty, senDuty, session: exam.session, startDateTime: exam.startDateTime, location: exam.location }
}

/**
 * Updates a teacher object with a new exam assignment.
 * Returns a new teacher object (pure).
 */
function assignExamToTeacher(teacher, exam) {
  const impact = calculateExamImpact(exam)
  const { timeAdded, fiDuty, sbDuty, guidanceDuty, senDuty, session, startDateTime, location } = impact
  
  const newTeacher = { ...teacher, exams: [...(teacher.exams || [])] }
  
  const examStart = DateTime.fromISO(startDateTime)
  const examEnd = examStart.plus({ minutes: timeAdded })

  // Check for duplicate assignment (same session/loc/day)
  const existingImpact = newTeacher.exams.find(e => 
    e.session == session &&
    e.location == location &&
    e.startDateTime.slice(0, 10) == startDateTime.slice(0, 10)
  )

  if (existingImpact) {
    const currentMinStart = DateTime.fromISO(existingImpact.minStart || existingImpact.startDateTime)
    const currentMaxEnd = DateTime.fromISO(existingImpact.maxEnd || DateTime.fromISO(existingImpact.startDateTime).plus({ minutes: existingImpact.timeAdded }).toISO())
    
    const newMinStart = examStart < currentMinStart ? examStart : currentMinStart
    const newMaxEnd = examEnd > currentMaxEnd ? examEnd : currentMaxEnd
    
    const newSpan = newMaxEnd.diff(newMinStart, 'minutes').minutes
    const oldSpan = existingImpact.timeAdded

    if (newSpan > oldSpan) {
      newTeacher.totalInvigilationTime = (newTeacher.totalInvigilationTime || 0) + (newSpan - oldSpan)
      existingImpact.timeAdded = newSpan
      existingImpact.minStart = newMinStart.toISO()
      existingImpact.maxEnd = newMaxEnd.toISO()
    }
    
    // Update SEN/General duty flags if the new exam provides them
    if (senDuty > (existingImpact.senDuty || 0)) {
      newTeacher.senDuty = (newTeacher.senDuty || 0) + (senDuty - existingImpact.senDuty)
      existingImpact.senDuty = senDuty
    }
    if (fiDuty > (existingImpact.fiDuty || 0)) {
      newTeacher.fiDuty = (newTeacher.fiDuty || 0) + (fiDuty - existingImpact.fiDuty)
      existingImpact.fiDuty = fiDuty
    }
    if (sbDuty > (existingImpact.sbDuty || 0)) {
      newTeacher.sbDuty = (newTeacher.sbDuty || 0) + (sbDuty - existingImpact.sbDuty)
      existingImpact.sbDuty = sbDuty
    }
    if (guidanceDuty > (existingImpact.guidanceDuty || 0)) {
      newTeacher.guidanceDuty = (newTeacher.guidanceDuty || 0) + (guidanceDuty - existingImpact.guidanceDuty)
      existingImpact.guidanceDuty = guidanceDuty
    }
    return newTeacher
  }

  newTeacher.occurrence = (newTeacher.occurrence || 0) + 1
  newTeacher.totalInvigilationTime = (newTeacher.totalInvigilationTime || 0) + timeAdded
  newTeacher.fiDuty = (newTeacher.fiDuty || 0) + fiDuty
  newTeacher.sbDuty = (newTeacher.sbDuty || 0) + sbDuty
  newTeacher.guidanceDuty = (newTeacher.guidanceDuty || 0) + guidanceDuty
  newTeacher.senDuty = (newTeacher.senDuty || 0) + senDuty
  
  newTeacher.exams.push({
    ...impact,
    minStart: examStart.toISO(),
    maxEnd: examEnd.toISO()
  })
  
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
       const lessonCount = getDayLessonsCount(t.teacher, exam, unavailableArrays)
       const effectiveSubNumber = t.ignoreSubstitutionNumber ? 0 : (t.originalSubstitutionNumber || 0)
       const subTime = effectiveSubNumber * 55

       // Smarter Penalty: Only apply duty penalty if the teacher has already cleared their debt.
       // This allows teachers with negative credits (like MCW) to take duties without being blocked from regular exams.
       const currentLoad = t.totalInvigilationTime + subTime
       const totalSpecialDuties = (t.fiDuty || 0) + (t.sbDuty || 0) + (t.guidanceDuty || 0)
       const dutyPenalty = currentLoad > 0 ? totalSpecialDuties * 60 : 0

       let score = (currentLoad + dutyPenalty + lessonCount * 55) / 120

       if (preferedTeachers && preferedTeachers.includes(t.teacher)) {
         score = Math.round(score * PREFERED_RATE)
       } else {
         score = Math.round(score)
       }
       return score
  }

  // Sorting Priorities

  // Return the index in preferedTeachers to maintain user's requested order (PIC first)
  const isPreferred = (t) => {
    if (!preferedTeachers || preferedTeachers.length === 0) return 999;
    const idx = preferedTeachers.indexOf(t.teacher);
    return idx === -1 ? 999 : idx;
  };

  if (exam.isFI || classlevel === 'FI') {
    return _.orderBy(
      candidates,
      [isPreferred, 'fiDuty', sortFunction, 'occurrence'],
      ['asc', 'asc', 'asc', 'asc']
    )
  }

  if (exam.isStandby || classlevel === 'SB') {
    return _.orderBy(
      candidates,
      [isPreferred, 'sbDuty', sortFunction, 'occurrence'],
      ['asc', 'asc', 'asc', 'asc']
    )
  }

  if (exam.isGuidance || exam.isMorning || classlevel === 'G') {
    return _.orderBy(
      candidates,
      [isPreferred, 'guidanceDuty', sortFunction, 'occurrence'],
      ['asc', 'asc', 'asc', 'asc']
    )
  }

  if (isSen) {
    return _.orderBy(
      candidates,
      [isPreferred, 'senDuty', sortFunction, 'occurrence'],
      ['asc', 'asc', 'asc', 'asc']
    )
  }

  return _.orderBy(candidates, [
    isPreferred,
    sortFunction,
    'occurrence'
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
         const newT = assignExamToTeacher({ teacher: invigilator, exams: [], totalInvigilationTime: 0, fiDuty: 0, sbDuty: 0, guidanceDuty: 0, occurrence: 0 }, exam)
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

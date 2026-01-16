const { DateTime, Interval } = require('luxon')
const {
  F1_F5_EXAM_PERIOD,
  F6_EXAM_PERIOD
} = require('../constants')
const { getExamInterval, getIntervalBySlot } = require('../utils')

/**
 * Checks if a teacher is physically unavailable during an exam interval.
 * @param {string} teacherId
 * @param {Interval} examInterval
 * @param {Array} unavailableArrays
 * @returns {boolean}
 */
function checkOverlapWithUnavailable(teacherId, examInterval, unavailableArrays) {
  return unavailableArrays.some(unavailable => {
    if (!unavailable.teachers.includes(teacherId)) return false
    return unavailable.slots.some(slot => 
      examInterval.overlaps(getIntervalBySlot(slot))
    )
  })
}

/**
 * Checks if a teacher is already assigned to another exam at the same time.
 * @param {string} teacherId
 * @param {Interval} examInterval
 * @param {Array} assignedExaminations
 * @returns {boolean}
 */
function isTeacherAssignedTimeConflict(teacherId, examInterval, assignedExaminations) {
   return assignedExaminations.some(assigned => {
     if (!assigned.invigilators.includes(teacherId)) return false
     return examInterval.overlaps(getExamInterval(assigned))
   })
}

/**
 * Gets exams assigned to a teacher on the same day as the target exam.
 * @param {string} teacherId
 * @param {Object} exam
 * @param {Array} assignedExaminations
 * @returns {Array}
 */
function getTeacherAssignedExamsOnSameDay(teacherId, exam, assignedExaminations) {
  const examStart = DateTime.fromISO(exam.startDateTime)
  return assignedExaminations.filter(assigned => {
    if (!assigned.invigilators.includes(teacherId)) return false
    
    // Ignore the exam itself (or its parts if split)
    if (assigned.session === exam.session && 
        assigned.location === exam.location &&
        assigned.startDateTime.slice(0, 10) === exam.startDateTime.slice(0, 10)) {
          return false
    }

    const assignedStart = DateTime.fromISO(assigned.startDateTime)
    return examStart.hasSame(assignedStart, 'day')
  })
}

/**
 * counts the number of lessons a teacher has in the relevant exam period (F1-F5 or F6).
 * Used for workload balancing.
 */
function getPeriodLessonCount(teacherId, exam, unavailableArrays) {
  const examInterval = getExamInterval(exam)
  const f1f5Int = Interval.fromISO(F1_F5_EXAM_PERIOD)
  const f6Int = Interval.fromISO(F6_EXAM_PERIOD)
  
  let targetPeriod = null
  if (examInterval.overlaps(f1f5Int)) targetPeriod = f1f5Int
  else if (examInterval.overlaps(f6Int)) targetPeriod = f6Int
  
  if (!targetPeriod) return 0
  
  const unavailables = unavailableArrays.filter(u => 
    u.teachers.includes(teacherId) && /D\dP\d/.test(u.remark)
  )
  
  let count = 0
  for (const u of unavailables) {
    for (const slot of u.slots) {
      if (targetPeriod.overlaps(getIntervalBySlot(slot))) {
        count++
      }
    }
  }
  return count
}

/**
 * Counts lessons on the specific exam day.
 */
function getDayLessonsCount(teacherId, exam, unavailableArrays) {
  const examStartTime = DateTime.fromISO(exam.startDateTime)
  const teacherUnavailables = unavailableArrays.filter(u => 
    u.teachers.includes(teacherId) && /D\dP\d/.test(u.remark)
  )

  let count = 0
  for (const unavailable of teacherUnavailables) {
    for (const slot of unavailable.slots) {
       const unavailableStartTime = DateTime.fromISO(slot.start)
       if (examStartTime.hasSame(unavailableStartTime, 'day')) {
         count++
       }
    }
  }
  return count
}

module.exports = {
  checkOverlapWithUnavailable,
  isTeacherAssignedTimeConflict,
  getTeacherAssignedExamsOnSameDay,
  getPeriodLessonCount,
  getDayLessonsCount
}

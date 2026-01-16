const _ = require('lodash')
const { getExamInterval, getIntervalBySlot } = require('../utils')

/**
 * Validates assignments against unavailable slots.
 */
function validateAssignments(assignedExaminations, unavailableArrays, ignoredSlots) {
  const crashes = []
  
  assignedExaminations.forEach(assignedExam => {
    const { invigilators } = assignedExam
    const examInterval = getExamInterval(assignedExam)

    invigilators.forEach(invigilator => {
       if (invigilator === 'UNASSIGNED') return

       unavailableArrays.forEach(unavailable => {
         if (!unavailable.teachers.includes(invigilator)) return
         
         unavailable.slots.forEach(slot => {
            const unavailableInterval = getIntervalBySlot(slot)
            if (examInterval.overlaps(unavailableInterval)) {
               const isIgnored = ignoredSlots && ignoredSlots.find(ign => 
                 ign.teacher == invigilator && ign.start == slot.start && ign.end == slot.end
               )
               
               if (!isIgnored) {
                 crashes.push({
                   exam: assignedExam,
                   invigilator,
                   slot,
                   remark: unavailable.remark
                 })
               }
            }
         })
       })
    })
  })
  
  return crashes
}

/**
 * Validates for double-booking collisions between assigned exams.
 */
function validateCollisions(assignedExaminations) {
  const collisions = []
  const sorted = _.sortBy(assignedExaminations, 'startDateTime')

  for (let i = 0; i < sorted.length; i++) {
    const examA = sorted[i]
    const intervalA = getExamInterval(examA)

    for (let j = i + 1; j < sorted.length; j++) {
      const examB = sorted[j]
      const intervalB = getExamInterval(examB)

      if (intervalB.start > intervalA.end) break

      if (intervalA.overlaps(intervalB)) {
        const shared = _.intersection(examA.invigilators, examB.invigilators)
          .filter(t => t !== 'UNASSIGNED')
          
        if (shared.length > 0) {
          const isBound =
            (examA.binding && examA.binding.some((bId) => bId === examB.id)) ||
            (examB.binding && examB.binding.some((bId) => bId === examA.id))

          if (examA.id === examB.id) continue

          if (!isBound) {
            collisions.push({ examA, examB, teachers: shared })
          }
        }
      }
    }
  }
  return collisions
}

module.exports = {
  validateAssignments,
  validateCollisions
}

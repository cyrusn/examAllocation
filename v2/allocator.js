const _ = require('lodash')
const { 
  getOrderedAvailableTeachers,
  assignExamToTeacher
} = require('./logic')
const { progressLog, getExamInterval } = require('./utils')

function countUnassigned(assignedExaminations) {
  return assignedExaminations.reduce((acc, e) => acc + e.invigilators.filter(i => i === 'UNASSIGNED').length, 0)
}

function applyReordering(examinations) {
  const dateDensities = {}
  examinations.forEach(e => {
    const date = e.startDateTime.substring(0, 10)
    if (!dateDensities[date]) dateDensities[date] = 0
    if (!e.binding || e.binding.length === 0) {
      dateDensities[date] += (e.requiredInvigilators || 0)
    }
  })

  // State 1 Sorting (Reordering based on density):
  // 1. Followers (bound exams) last
  // 2. Date (Ascending) - Process day by day
  // 3. Date Density (Descending) - Handle heaviest days first
  // 4. Exam Type Priority: FI (0) > Normal/SEN (1) > Guidance/Morning (2) > Standby (3)
  // 5. Duration (Descending) - Longest exams first
  // 6. Bindings Count (Descending) - Exams that pull followers
  // 7. Time (Ascending)
  return _.orderBy(examinations, [
    e => e.binding && e.binding.length > 0 ? 1 : 0, 
    e => e.startDateTime.substring(0, 10),
    e => dateDensities[e.startDateTime.substring(0, 10)] || 0, 
    e => {
      if (e.isFI || e.classlevel === 'FI') return 0
      if (e.isGuidance || e.isMorning || e.classlevel === 'G') return 2
      if (e.isStandby || e.classlevel === 'SB') return 3
      return 1 // Normal/SEN exams
    },
    e => e.duration, 
    e => examinations.filter(f => f.binding && f.binding.includes(e.id)).length, 
    e => e.startDateTime 
  ], ['asc', 'asc', 'desc', 'asc', 'desc', 'desc', 'asc'])
}

function performGreedyAllocation(examinationsList, teachers, unavailableArrays, globalOptions = {}) {
  const assignedExaminations = examinationsList.filter(e => e.invigilators.length > 0)
  const totalExams = examinationsList.length
  let processedCount = 0

  // Update teachers with pre-assigned exams
  initializeAssignments(teachers, assignedExaminations)

  for (const exam of examinationsList) {
    processedCount++
    progressLog(processedCount / totalExams)

    const bindedExams = examinationsList.filter(e => e.binding.includes(exam.id))
    
    bindedExams.forEach(follower => {
      follower.requiredInvigilators = exam.requiredInvigilators
      exam.invigilators.forEach(inv => {
        if (!follower.invigilators.includes(inv)) {
          follower.invigilators.push(inv)
        }
      })
    })

    const currentInvigilatorCount = exam.invigilators.length
    if (currentInvigilatorCount >= exam.requiredInvigilators) continue

    const candidates = findCandidatesWithRetry(teachers, unavailableArrays, assignedExaminations, exam, bindedExams, globalOptions)
    const needed = exam.requiredInvigilators - currentInvigilatorCount
    const selected = selectTeachers(candidates, needed, exam)

    if (selected.length === 0) continue

    applyAssignments(teachers, [exam, ...bindedExams], selected);

    [exam, ...bindedExams].forEach(e => {
      if (!assignedExaminations.includes(e)) {
        assignedExaminations.push(e)
      }
    })
  }
  return assignedExaminations
}

/**
 * Runs the main allocation algorithm.
 * 
 * @param {Array} originalExaminations - List of exam objects
 * @param {Array} originalTeachers - List of teacher objects
 * @param {Array} unavailableArrays - List of unavailable time slots
 * @returns {Array} assignedExaminations - List of exams with assigned invigilators
 */
function allocateExaminations(originalExaminations, originalTeachers, unavailableArrays, globalOptions = {}) {
  console.log('\n--- State 0: Normal Assignment ---')
  let examinations = _.cloneDeep(originalExaminations)
  let teachers = _.cloneDeep(originalTeachers)

  // State 0 Sorting:
  // 1. Followers (bound exams) last
  // 2. Date (Ascending) - Process day by day
  // 3. Exam Type Priority: FI (0) > Normal/SEN (1) > Guidance/Morning (2) > Standby (3)
  // 4. Duration (Descending) - Longest exams first on that day
  // 5. Time (Ascending) - Morning to afternoon
  examinations = _.orderBy(examinations, [
    e => e.binding && e.binding.length > 0 ? 1 : 0, 
    e => e.startDateTime.substring(0, 10), 
    e => {
      if (e.isFI || e.classlevel === 'FI') return 0
      if (e.isGuidance || e.isMorning || e.classlevel === 'G') return 2
      if (e.isStandby || e.classlevel === 'SB') return 3
      return 1 // Normal/SEN exams
    },
    e => e.duration, 
    e => e.startDateTime 
  ], ['asc', 'asc', 'asc', 'desc', 'asc'])

  let assignedExaminations = performGreedyAllocation(examinations, teachers, unavailableArrays, globalOptions)
  let unassignedCount = countUnassigned(assignedExaminations)  
  if (unassignedCount > 0) {
    console.log(`\nState 0 resulted in ${unassignedCount} UNASSIGNED slots.`)
    console.log('\n--- State 1: Applying Idea 1 (Deterministic Multi-Factor Reordering) ---')
    
    // Reset state to original
    examinations = _.cloneDeep(originalExaminations)
    teachers = _.cloneDeep(originalTeachers)
    
    const sortedExaminations = applyReordering(examinations)
    assignedExaminations = performGreedyAllocation(sortedExaminations, teachers, unavailableArrays, globalOptions)
    unassignedCount = countUnassigned(assignedExaminations)
  }

  if (unassignedCount > 0) {
    console.log(`\nState 1 resulted in ${unassignedCount} UNASSIGNED slots.`)
    console.log('\n--- State 2: Applying Idea 2 (1-Degree Swap Repair) ---')
    repairAssignments(teachers, assignedExaminations, unavailableArrays, originalExaminations, globalOptions)
  }

  return assignedExaminations
}

/**
 * Idea 2: Local Repair Swap
 */
function repairAssignments(teachers, assignedExaminations, unavailableArrays, originalExaminations) {
  let swapped = true
  let loopCount = 0
  const MAX_LOOPS = 50
  let totalSwaps = 0

  while (swapped && loopCount < MAX_LOOPS) {
    swapped = false
    loopCount++

    // 1. Find an exam with UNASSIGNED
    const examWithGap = assignedExaminations.find(e => e.invigilators.includes('UNASSIGNED'))
    if (!examWithGap) break

    // Define the group of the gap exam
    const e1Binds = assignedExaminations.filter(e => e.binding && e.binding.includes(examWithGap.id))
    const e1Group = [examWithGap, ...e1Binds]
    const e1Interval = getExamInterval(examWithGap)

    // 2. Find overlapping exams
    const overlappingExams = assignedExaminations.filter(e => {
      if (e1Group.some(g => g.id === e.id)) return false
      
      // Exclude exams in the same binding group to prevent cannibalizing bound exams
      const isBound =
        (examWithGap.binding && examWithGap.binding.includes(e.id)) ||
        (e.binding && e.binding.includes(examWithGap.id)) ||
        (examWithGap.binding && e.binding && _.intersection(examWithGap.binding, e.binding).length > 0)
      if (isBound) return false

      return getExamInterval(e).overlaps(e1Interval)
    })

    // Group overlapping exams by master
    const overlappingMasters = _.uniq(overlappingExams.map(e => {
      if (e.binding && e.binding.length > 0) {
        const master = assignedExaminations.find(m => m.id === e.binding[0])
        return master || e
      }
      return e
    }))

    let foundSwap = false

    for (const E2 of overlappingMasters) {
      const e2Binds = assignedExaminations.filter(e => e.binding && e.binding.includes(E2.id))
      const e2Group = [E2, ...e2Binds]

      const e2Teachers = E2.invigilators.filter(id => id !== 'UNASSIGNED')
      
      for (const tBusyId of e2Teachers) {
        // Prevent swapping out pre-assigned teachers
        const origE2 = originalExaminations.find(e => e.id === E2.id)
        const preAssignedTeachers = origE2 ? origE2.invigilators : []
        if (preAssignedTeachers.includes(tBusyId)) continue

        // Prevent swapping in a teacher already assigned to this gap exam (prevents duplicates)
        if (examWithGap.invigilators.includes(tBusyId)) continue

        // Create a hypothetical state without E2 group
        const assignedWithoutE2Group = assignedExaminations.filter(e => !e2Group.some(g => g.id === e.id))
        
        // Is tBusyId valid for E1 group in this state?
        const e1Cands = findCommonCandidates(teachers, unavailableArrays, assignedWithoutE2Group, examWithGap, e1Binds, { strict: false })
        if (!e1Cands.some(t => t.teacher === tBusyId)) continue

        // 3. Find a replacement for E2
        const e2Cands = findCommonCandidates(teachers, unavailableArrays, assignedWithoutE2Group, E2, e2Binds, { strict: false })
        
        // Replacement must not be the busy teacher, someone already assigned to E1, nor someone already assigned to E2
        const tFreeObj = e2Cands.find(t => 
          t.teacher !== tBusyId && 
          !examWithGap.invigilators.includes(t.teacher) &&
          !E2.invigilators.includes(t.teacher)
        )
        
        if (tFreeObj) {
          const tFreeId = tFreeObj.teacher
          
          // 4. Execute Swap
          e1Group.forEach(e => {
            const idx = e.invigilators.indexOf('UNASSIGNED')
            if (idx !== -1) e.invigilators[idx] = tBusyId
          })
          
          e2Group.forEach(e => {
            const idx = e.invigilators.indexOf(tBusyId)
            if (idx !== -1) e.invigilators[idx] = tFreeId
          })
          
          rebuildTeacherStats(teachers, assignedExaminations)
          swapped = true
          foundSwap = true
          totalSwaps++
          console.log(`  -> Swap Success: Moved ${tBusyId} from ${E2.id} to ${examWithGap.id}. Filled ${E2.id} with ${tFreeId}.`)
          break
        }
      }
      if (foundSwap) break
    }
  }
  
  if (totalSwaps > 0) {
    console.log(`Completed Idea 2 Repair: Successfully performed ${totalSwaps} swap(s).`)
  } else {
    console.log(`Completed Idea 2 Repair: Could not find any valid swaps to perform.`)
  }
}

function rebuildTeacherStats(teachers, assignedExaminations) {
  teachers.forEach(t => {
    t.exams = []
    t.totalInvigilationTime = 0
    t.fiDuty = 0
    t.sbDuty = 0
    t.guidanceDuty = 0
    t.senDuty = 0
    t.occurrence = 0
    t.blockedByLessons = 0
  })
  
  assignedExaminations.forEach(exam => {
    exam.invigilators.forEach(inv => {
      if (inv === 'UNASSIGNED') return
      const tIndex = teachers.findIndex(t => t.teacher === inv)
      if (tIndex !== -1) {
        teachers[tIndex] = assignExamToTeacher(teachers[tIndex], exam)
      }
    })
  })
}

/**
 * Helper: Initializes teacher states with pre-assigned exams.
 */
function initializeAssignments(teachers, assignedExaminations) {
  assignedExaminations.forEach(exam => {
    exam.invigilators.forEach(invigilator => {
      const tIndex = teachers.findIndex(t => t.teacher === invigilator)
      if (tIndex !== -1) {
        teachers[tIndex] = assignExamToTeacher(teachers[tIndex], exam)
      }
    })
  })
}

/**
 * Helper: Finds candidates using strict rules, then falls back to relaxed.
 */
function findCandidatesWithRetry(teachers, unavailableArrays, assignedExaminations, exam, bindedExams) {
    let candidateTeachers = findCommonCandidates(
      teachers, unavailableArrays, assignedExaminations, exam, bindedExams, { strict: true }
    )

    // Retry with relaxed constraints if needed
    const needed = exam.requiredInvigilators - exam.invigilators.length
    if (candidateTeachers.length < needed) {
      candidateTeachers = findCommonCandidates(
        teachers, unavailableArrays, assignedExaminations, exam, bindedExams, { ...globalOptions, strict: false }
      )
    }
    return candidateTeachers
}

/**
 * Helper: Finds common candidates for an exam and its bindings.
 */
function findCommonCandidates(teachers, unavailableArrays, assignedExaminations, exam, bindedExams, options) {
  let candidates = getOrderedAvailableTeachers(
    teachers, unavailableArrays, assignedExaminations, exam, options
  )

  for (const bindedExam of bindedExams) {
    const bindedCandidates = getOrderedAvailableTeachers(
      teachers, unavailableArrays, assignedExaminations, bindedExam, options
    )
    candidates = _.intersectionBy(candidates, bindedCandidates, 'teacher')
  }
  return candidates
}

/**
 * Helper: Selects N teachers from the candidate list, filling gaps with UNASSIGNED.
 */
function selectTeachers(candidates, count, exam) {
    const selected = []
    for (let i = 0; i < count; i++) {
      const teacherObj = candidates[i]
      if (!teacherObj) {
        console.warn(`
WARNING: Could not find enough teachers for ${exam.id} ${exam.title} (${exam.startDateTime}). Need ${count - i} more.`) // eslint-disable-line no-console
        selected.push('UNASSIGNED')
        continue
      }
      selected.push(teacherObj.teacher)
    }
    return selected
}

/**
 * Helper: Applies assignments to exams and updates teacher stats.
 */
function applyAssignments(teachers, examsToUpdate, teacherIds) {
    teacherIds.forEach(teacherId => {
      if (teacherId === 'UNASSIGNED') {
         examsToUpdate.forEach(e => {
            if (!e.invigilators.includes(teacherId)) e.invigilators.push(teacherId)
         })
         return
      }

      // Update all exams in the group with the teacher ID
      examsToUpdate.forEach(e => {
        if (!e.invigilators.includes(teacherId)) {
          e.invigilators.push(teacherId)
        }
      })

      // Update teacher statistics for ALL exams in the bound group
      const tIndex = teachers.findIndex(t => t.teacher === teacherId)
      if (tIndex !== -1) {
        examsToUpdate.forEach(e => {
          teachers[tIndex] = assignExamToTeacher(teachers[tIndex], e)
        })
      }
    })
}

module.exports = {
  allocateExaminations
}
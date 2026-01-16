const _ = require('lodash')
const { 
  getOrderedAvailableTeachers,
  assignExamToTeacher
} = require('./logic')
const { progressLog } = require('./utils')

/**
 * Runs the main allocation algorithm.
 * 
 * @param {Array} examinations - List of exam objects
 * @param {Array} teachers - List of teacher objects
 * @param {Array} unavailableArrays - List of unavailable time slots
 * @returns {Array} assignedExaminations - List of exams with assigned invigilators
 */
function allocateExaminations(examinations, teachers, unavailableArrays) {
  const assignedExaminations = examinations.filter(e => e.invigilators.length > 0)
  const totalExams = examinations.length
  let processedCount = 0

  // Update teachers with pre-assigned exams
  initializeAssignments(teachers, assignedExaminations)

  // Iterate through all exams
  for (const exam of examinations) {
    processedCount++
    progressLog(processedCount / totalExams)

    const currentInvigilatorCount = exam.invigilators.length
    if (currentInvigilatorCount >= exam.requiredInvigilators) {
      continue
    }

    // Identify Bindings
    const bindedExams = examinations.filter(e => e.binding.includes(exam.id))
    
    // Find Candidates
    const candidates = findCandidatesWithRetry(teachers, unavailableArrays, assignedExaminations, exam, bindedExams)

    // Select Teachers
    const needed = exam.requiredInvigilators - currentInvigilatorCount
    const selected = selectTeachers(candidates, needed, exam)

    if (selected.length === 0) continue

    // Apply Assignments
    applyAssignments(teachers, [exam, ...bindedExams], selected);

    // Track state
    [exam, ...bindedExams].forEach(e => {
      if (!assignedExaminations.includes(e)) {
        assignedExaminations.push(e)
      }
    })
  }
  
  return assignedExaminations
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
      const relaxedCandidates = findCommonCandidates(
        teachers, unavailableArrays, assignedExaminations, exam, bindedExams, { strict: false }
      )
      
      // If relaxed gave us more, use them (or a mix? Logic usually takes relaxed set as valid fallback)
      // Usually relaxed set implies strictly valid ones are included or we take union?
      // getOrderedAvailableTeachers returns *all* valid under the constraints.
      // Strict subset is inside Relaxed set. So we just take relaxed.
      candidateTeachers = relaxedCandidates
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

      examsToUpdate.forEach(e => {
        if (!e.invigilators.includes(teacherId)) {
          e.invigilators.push(teacherId)
        }
        
        const tIndex = teachers.findIndex(t => t.teacher === teacherId)
        if (tIndex !== -1) {
          teachers[tIndex] = assignExamToTeacher(teachers[tIndex], e)
        }
      })
    })
}

module.exports = {
  allocateExaminations
}
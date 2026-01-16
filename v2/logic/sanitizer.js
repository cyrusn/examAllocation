const _ = require('lodash')
const { validateCollisions } = require('./validation')
const { GENERAL_DUTIES } = require('../constants')

/**
 * Detects and resolves collisions in pre-assigned examinations.
 * Modifies the invigilators list of conflicting exams in place.
 * 
 * @param {Array} examinations - The full list of examinations
 * @returns {Array} - The updated list of assigned examinations (subset of input)
 */
function sanitizeCollisions(examinations) {
  let assignedExaminations = examinations.filter(e => e.invigilators.length > 0)
  const preCollisions = validateCollisions(assignedExaminations)
  
  if (preCollisions.length > 0) {
    console.log(`Found ${preCollisions.length} collisions in pre-assignments. Resolving...`)
    
    preCollisions.forEach(({ examA, examB, teachers: collidedTeachers }) => {
       // Prioritize General Duties (e.g. Guidance Duty, Standby) over Subject Exams
       const isFixedA = GENERAL_DUTIES.includes(examA.classlevel)
       const isFixedB = GENERAL_DUTIES.includes(examB.classlevel)
       
       let victim;
       if (isFixedA && !isFixedB) {
         victim = examB
       } else if (!isFixedA && isFixedB) {
         victim = examA
       } else {
         // Fallback: remove from the one that starts later (or arbitrary if same)
         victim = (examA.startDateTime >= examB.startDateTime) ? examA : examB
       }
       
       const source = (victim === examA) ? examB : examA

       collidedTeachers.forEach(t => {
         if (victim.invigilators.includes(t)) {
            console.log(`Resolving Conflict: Removing ${t} from ${victim.id} (${victim.title}) to keep ${source.id} (${source.title})`)
            _.pull(victim.invigilators, t)
         }
       })
    })
    
    // Refresh the assigned list after modifications
    assignedExaminations = examinations.filter(e => e.invigilators.length > 0)
  }
  
  return assignedExaminations
}

module.exports = { sanitizeCollisions }

const _ = require('lodash')
const { parseList } = require('./utils')
const { INVIGILATOR_RULES, DEFAULT_INVIGILATOR_COUNT } = require('./config')

/**
 * Transforms raw teacher data from sheet into application objects.
 */
function parseTeachers(rawTeachers) {
  return rawTeachers.map((t) => ({
    ...t,
    originalSubstitutionNumber: parseInt(t.substitutionNumber) || 0,
    totalInvigilationTime: 0,
    generalDuty: 0,
    occurrence: 0,
    exams: [],// Track assigned exams
  }))
}

/**
 * Transforms raw unavailable data into structured objects with Intervals.
 */
function parseUnavailables(rawUnavailables) {
  return rawUnavailables.map((r) => {
    const { teachers, slots, remark } = r
    return {
      teachers: parseList(teachers),
      slots: parseList(slots).map((slot) => {
        const [start, end] = slot.split('/')
        return { start, end }
      }),
      remark
    }
  })
}

/**
 * Transforms raw examination data, handling bindings, splitting classes, and applying rules.
 */
function parseExaminations(rawExaminations) {
  return _(rawExaminations)
    .filter(({ skip, id }) => !skip && id)
    .orderBy([(a) => (a.binding && a.binding.length > 0) ? 1 : 0], ['asc'])
    .reduce((prev, exam) => {
      const { binding, id, session, classlevel, title, startDateTime } = exam
      
      const invigilators = parseList(exam.invigilators)
      const preferedTeachers = parseList(exam.preferedTeachers)
      const paperInChargesList = parseList(exam.paperInCharges)
      
      const titleUpper = (exam.title || '').toUpperCase()
      const isStandby = titleUpper.includes('STANDBY') || exam.classlevel === 'SB'
      const isGuidance = titleUpper.includes('GUIDANCE DUTY') || exam.classlevel === 'G'
      const isMorning = titleUpper.includes('MORNING')
      
      let duration = parseInt(exam.duration)
      const isDurationNA = isNaN(duration)
      
      if (isDurationNA || isStandby || isGuidance || isMorning) {
        duration = 180
      }

      let finalSession = (session !== undefined && session !== null && session !== '') ? parseInt(session) : undefined
      
      const isFI = exam.classlevel === 'FI'

      // Force Morning Duty and Guidance Duty to start of the day
      if (isGuidance || isMorning) {
        finalSession = 0
      } else if (finalSession === undefined) {
         // Default session assignment
         if (isStandby || isFI) {
           finalSession = 99 // End of the day
         } else {
           finalSession = 99 // Default for everything else
         }
      }

      const classcodes = parseList(exam.classcodes).filter(Boolean)
      const locations = parseList(exam.locations || exam.location)

      classcodes.forEach((classcode, index) => {
        let location = locations[index] || locations[0] || ''
        location = location.trim()
        if (location.toUpperCase() === 'HALL') location = 'HALL'
        
        const currentId = `${id}-${index}`
        const isSen = /\d{1}S(R|T)?/.test(classcode)

        // Binding Logic
        let bindingIds = []
        
        if (binding === 'false' || binding === false) {
          // Rule 2: Explicitly false means no binding
          bindingIds = []
        } else if (binding) {
          // Rule 1: Explicit IDs provided
          const targetRowIds = parseList(binding).filter(Boolean)
          targetRowIds.forEach(targetRowId => {
            // Find ALL classes in the target row (regardless of session/time)
            const rowExams = prev.filter(e => 
              e.id.startsWith(`${targetRowId.trim()}-`)
            )

            if (rowExams.length > 0) {              // Look for a specific match in the same room
              const master = rowExams.find(e => e.location === location)
              if (master) {
                bindingIds.push(master.id)
              } else {
                console.warn(`[Binding Warning] Row ${targetRowId} found, but none of its classes are in room ${location}. Binding skipped for ${currentId}.`)
              }
            } else {
              console.warn(`[Binding Warning] Target row ${targetRowId} not found or occurs at a different time. Binding skipped for ${currentId}.`)
            }
          })
        } 
        
        // Rule 3: Auto-bind across the whole day for same room (excluding special duties)
        const isSpecialDuty = isStandby || isFI || isGuidance || isMorning;
        if (!isSpecialDuty && location && bindingIds.length === 0 && binding !== 'false' && binding !== false) {
          const autoMaster = prev.find(e => 
            e.location === location && 
            e.startDateTime.substring(0, 10) === (startDateTime || '').substring(0, 10) &&
            !e.isStandby && !e.isFI && !e.isGuidance && !e.isMorning
          )
          if (autoMaster) {
            bindingIds.push(autoMaster.id)
          }
        }

        // Invigilator Count Logic
        const reqInvList = parseList(String(exam.requiredInvigilators))
        let requiredInvigilators = parseInt(reqInvList[index])

        if (!requiredInvigilators) {
          const context = { classlevel, classcode, title, session, location, index }
          const rule = INVIGILATOR_RULES.find(r => r.match(context))
          requiredInvigilators = rule ? rule.count : DEFAULT_INVIGILATOR_COUNT
        }

        // Pre-assigned invigilators
        let preAssignedInvigilators = []
        if (invigilators[index]) {
          preAssignedInvigilators = invigilators[index].replaceAll(/\n|\s|\r/g, '').split('|').filter(Boolean)
        }

        let assignedPaperInCharges = []
        if (paperInChargesList[index]) {
          assignedPaperInCharges = paperInChargesList[index].replaceAll(/\n|\s|\r/g, '').split('|').filter(Boolean)
        }

        // Preferred teachers (positional and separated by pipe)
        let assignedPreferedTeachers = []
        if (preferedTeachers[index]) {
          assignedPreferedTeachers = preferedTeachers[index].replaceAll(/\n|\s|\r/g, '').split('|').filter(Boolean)
        }

        prev.push({
          binding: bindingIds,
          id: `${id}-${index}`,
          session: finalSession,
          classlevel,
          classcode,
          title,
          startDateTime,
          duration,
          isDurationNA,
          isStandby,
          isGuidance,
          isMorning,
          isFI,
          requiredInvigilators,
          paperInCharges: assignedPaperInCharges,
          location,
          invigilators: preAssignedInvigilators,
          preferedTeachers: assignedPreferedTeachers
        })
      })

      return prev
    }, [])
}

module.exports = {
  parseTeachers,
  parseUnavailables,
  parseExaminations
}

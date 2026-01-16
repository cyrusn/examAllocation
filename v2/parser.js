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
    totalInvigilationTime: (parseInt(t.substitutionNumber) || 0) * 55 || 0,
    generalDuty: 0,
    occurrence: 0,
    exams: [] // Track assigned exams
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
    .orderBy([(a) => !!a.binding], ['desc'])
    .reduce((prev, exam) => {
      const { binding, id, session, classlevel, title, startDateTime } = exam
      
      const invigilators = parseList(exam.invigilators)
      const preferedTeachers = parseList(exam.preferedTeachers)
      const paperInCharges = parseList(exam.paperInCharges)
      const duration = parseInt(exam.duration)
      const classcodes = parseList(exam.classcodes)

      classcodes.forEach((classcode, index) => {
        // Expand binding IDs
        const bindingIds = binding 
          ? parseList(binding).map(a => `${a.trim()}-${index}`)
          : []

        // Locations
        const locations = String(exam.locations).replaceAll(/\n|\s|\r/g, '').split(',')
        const location = locations[index]

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

        prev.push({
          binding: bindingIds,
          id: `${id}-${index}`,
          session: session || 99,
          classlevel,
          classcode,
          title,
          startDateTime,
          duration,
          requiredInvigilators,
          paperInCharges: [...paperInCharges],
          location,
          invigilators: preAssignedInvigilators,
          preferedTeachers
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

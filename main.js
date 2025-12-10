require('dotenv').config()
const _ = require('lodash')
const fs = require('fs')

const {
  GENERAL_DUTIES,
  getOrderedAvailableTeachers,
  updateSubstitutionNumber,
  finalCheck,
  checkAssignedCrashWithUnavailable
} = require('./helper.js')

const {
  printView,
  printStat,
  printSen,
  printTeacherView
} = require('./printHelper')

const { getSheetData } = require('./googleSheet.js')

const outputFilePath = './out'

const main = async () => {
  const SPREADSHEET_ID = process.env['SPREADSHEET_ID']
  // clear result sheet first
  const rawExaminations = await getSheetData(SPREADSHEET_ID, 'exam!A:O')
  const rawUnavailables = await getSheetData(SPREADSHEET_ID, 'unavailables!A:C')
  const ignoredSlots = await getSheetData(
    SPREADSHEET_ID,
    'ignoredUnavailables!A:D'
  )

  const rawTeachers = await getSheetData(SPREADSHEET_ID, 'teachers!A:D')
  const teachers = rawTeachers.map((t) => {
    t.originalSubstitutionNumber = parseInt(t.substitutionNumber) || 0
    t.substitutionNumber = parseInt(t.substitutionNumber) || 0
    t.totalInvigilationTime = t.substitutionNumber * 55 || 0
    t.generalDuty = 0
    t.occurrence = 0
    return t
  })

  // console.log(teachers)

  const examinations = _(rawExaminations)
    .filter(({ skip, id }) => !skip && id)
    .orderBy(
      [
        ({ preferedTeachers }) => {
          if (preferedTeachers)
            return preferedTeachers.split(',').map((a) => a.trim()).length
          return 999
        },
        (exam) => {
          const { startDateTime } = exam
          return startDateTime.split('T')[0]
        },
        ({ binding }) => {
          if (binding)
            return String(binding)
              .split(',')
              .map((a) => a.trim()).length
          return 999
        },
        ({ invigilators }) => {
          if (invigilators)
            return String(invigilators)
              .split(',')
              .map((a) => a.trim()).length
          return 999
        },
        'duration'
      ],
      ['asc', 'asc', 'asc', 'asc', 'desc']
    )
    .reduce((prev, exam) => {
      const { binding, id, session, classlevel, title, startDateTime } = exam

      // console.log(exam)
      const invigilators =
        exam.invigilators?.replaceAll(/\n|\s|\r/g, '').split(',') || []
      const preferedTeachers =
        exam.preferedTeachers?.replaceAll(/\n|\s|\r/g, '').split(',') || []
      const paperInCharges =
        exam.paperInCharges?.replaceAll(/\n|\s|\r/g, '').split(',') || []
      const duration = parseInt(exam.duration)

      const classcodes = exam.classcodes
      classcodes
        .replaceAll(/\n|\s|\r/g, '')
        .split(',')
        .forEach((classcode, index) => {
          // console.log(exam)
          prev.push({
            binding: binding
              ? `${binding}`
                  .replaceAll(/\n|\s|\r/g, '')
                  .split(',')
                  .map((a) => `${a.trim()}-${index}`)
              : [],
            id: `${id}-${index}`,
            session: session || 99,
            classlevel,
            classcode,
            title,
            startDateTime,
            duration,
            requiredInvigilators: String(exam.requiredInvigilators)
              .replaceAll(/\n|\s|\r/g, '')
              .split(',')
              .map((r) => parseInt(r))[index],
            paperInCharges: [...paperInCharges],
            location: String(exam.locations)
              .replaceAll(/\n|\s|\r/g, '')
              .split(',')[index],
            invigilators:
              _.compact(
                invigilators[index]
                  ?.replaceAll(/\n|\s|\r/g, '')
                  .split('|')
                  .map((a) => a.trim())
              ) || [],
            preferedTeachers
          })
        })

      return prev
    }, [])

  const unavailableArrays = rawUnavailables.map((r) => {
    const { teachers, slots, remark } = r
    return {
      teachers: teachers.replaceAll(/\n|\s|\r/g).split(','),
      slots: slots
        .replaceAll(/\n|\s|\r/g, '')
        .split(',')
        .map((slot) => {
          const [start, end] = slot.split('/')
          return {
            start,
            end
          }
        }),
      remark
    }
  })

  const assignedExaminations = examinations.filter(
    ({ invigilators }) => invigilators.length
  )

  checkAssignedCrashWithUnavailable(
    assignedExaminations,
    unavailableArrays,
    ignoredSlots
  )

  // assignedExaminations.forEach((exam) => {
  //   const { invigilators } = exam
  //   // if (exam.id.includes('5090')) {
  //   //   console.log(invigilators)
  //   // }
  //   invigilators.forEach((invigilator) => {
  //     updateSubstitutionNumber(teachers, invigilator, exam)
  //   })
  // })

  _(examinations).forEach((exam) => {
    const {
      classlevel,
      classcode,
      requiredInvigilators,
      invigilators,
      preferedTeachers,
      duration
    } = exam
    const bindedExams = []

    for (const e of examinations) {
      if (e.binding.includes(exam.id)) {
        bindedExams.push(e)
      }
    }

    const examAvailbleTeachers = getOrderedAvailableTeachers(
      teachers,
      unavailableArrays,
      assignedExaminations,
      exam
    )
    // console.log(examAvailbleTeachers)

    const _availableTeachers = bindedExams.reduce(
      (prev, bindedExam) => {
        const currentAvailableTeachers = getOrderedAvailableTeachers(
          teachers,
          unavailableArrays,
          assignedExaminations,
          bindedExam
        )
        prev = _.intersectionBy(prev, currentAvailableTeachers, 'teacher')
        return prev
      },
      [...examAvailbleTeachers]
    )

    const availableTeachers = _(_availableTeachers)
      .orderBy((t) => {
        if (preferedTeachers.length == 0) return false
        return preferedTeachers.includes(t.teacher)
      }, 'desc')
      .value()

    const len = invigilators.length

    const selectedTeachers = []

    for (let i = 0; i < requiredInvigilators - len; i++) {
      const targetTeacher = availableTeachers[i]
      if (!targetTeacher) {
        const { title, id, classlevel, classcode, startDateTime } = exam
        console.error(
          'Not Assigned:',
          startDateTime,
          id,
          classlevel,
          classcode,
          title
        )
        continue
      }

      const { teacher } = targetTeacher

      // console.log('inside requiredInvigilators')
      selectedTeachers.push(teacher)
    }
    let isAddedInBinding = false

    for (let assignedExam of assignedExaminations) {
      const { id } = assignedExam

      if (exam.binding.includes(id)) {
        assignedExam.invigilators.push(...selectedTeachers)
        isAddedInBinding = isAddedInBinding || true
      }
    }

    const found = assignedExaminations.find(({ id }) => id == exam.id)

    if (found) {
      if (!isAddedInBinding) {
        found.invigilators.push(...selectedTeachers)
      }
      return
    }

    for (const e of bindedExams) {
      if (e.binding.includes(exam.id)) {
        e['invigilators'].push(...selectedTeachers)
        // assignedExaminations.push(e)
      }
    }

    exam['invigilators'].push(...selectedTeachers)
    assignedExaminations.push(exam)
  })

  console.log(assignedExaminations.length, 'examinations are assigned')

  const finalAssignedExaminations = _.sortBy(assignedExaminations, [
    'startDateTime',
    'classlevel',
    'classcode'
  ])

  checkAssignedCrashWithUnavailable(
    finalAssignedExaminations,
    unavailableArrays,
    ignoredSlots
  )

  finalCheck(finalAssignedExaminations)

  fs.writeFileSync(
    outputFilePath + '/result.json',
    JSON.stringify(finalAssignedExaminations, null, ''),
    'utf8'
  )

  await printStat(finalAssignedExaminations)
  await printView(finalAssignedExaminations)
  await printSen(finalAssignedExaminations)
  await printTeacherView(finalAssignedExaminations)
}

main()

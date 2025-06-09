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

const { printView } = require('./printHelper')

const { getSheetData, batchClearData } = require('./googleSheet.js')

const outputFilePath = './out'

const main = async () => {
  const SPREADSHEET_ID = process.env['SPREADSHEET_ID']
  // clear result sheet first
  await batchClearData(SPREADSHEET_ID, 'result!A:Z')
  await batchClearData(SPREADSHEET_ID, 'stat!A:Z')
  const rawExaminations = await getSheetData(SPREADSHEET_ID, 'exam!A:I')
  const rawUnavailables = await getSheetData(SPREADSHEET_ID, 'unavailables!A:C')
  const rawTeachers = await getSheetData(SPREADSHEET_ID, 'teachers!A:D')
  const ignoredSlots = await getSheetData(
    SPREADSHEET_ID,
    'ignoredUnavailables!A:D'
  )

  const teachers = rawTeachers.map((t) => {
    t.originalSubstitutionNumber = parseInt(t.substitutionNumber)
    t.substitutionNumber = parseInt(t.substitutionNumber)
    t.totalInvigilationTime = 0
    t.generalDuty = 0
    t.occurrence = 0
    return t
  })

  // console.log(teachers)

  const examinations = _(rawExaminations)
    .orderBy(
      [
        (exam) => {
          const { classlevel, startDateTime } = exam
          if (classlevel == 'FI') {
            return '8' + startDateTime
          }
          if (GENERAL_DUTIES.includes(classlevel)) {
            return '9' + startDateTime
          }
          return startDateTime
        },
        'invigilators',
        'duration'
      ],
      ['asc', 'asc', 'desc']
    )

    .reduce((prev, exam) => {
      const { classlevel, title, startDateTime } = exam

      const invigilators = exam.invigilators?.split(',') || []
      const paperInCharges = exam.paperInCharges?.split(',') || []
      const duration = parseInt(exam.duration)

      const classcodes = exam.classcodes
      classcodes.split(',').forEach((classcode, index) => {
        prev.push({
          classlevel,
          classcode,
          title,
          startDateTime,
          duration,
          requiredInvigilators: exam.requiredInvigilators
            .split(',')
            .map((r) => parseInt(r))[index],
          paperInCharges: [...paperInCharges],
          location: exam.locations.split(',')[index],
          invigilators: _.compact(invigilators[index]?.split('|')) || []
        })
      })

      return prev
    }, [])

  const unavailableArrays = rawUnavailables.map((r) => {
    const { teachers, slots, remark } = r
    return {
      teachers: teachers.split(','),
      slots: slots
        .replaceAll('\n', '')
        .replaceAll('\r', '')
        .replaceAll(' ', '')
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

  assignedExaminations.forEach((exam) => {
    const { classcode, invigilators, duration } = exam
    invigilators.forEach((invigilator) => {
      const senDuration = Math.ceil(duration * 1.25)
      updateSubstitutionNumber(
        teachers,
        invigilator,
        classcode.match(/\d{1}S(R|T)?/) ? senDuration : duration
      )
    })
  })

  _(examinations).forEach((exam) => {
    const {
      classlevel,
      classcode,
      requiredInvigilators,
      invigilators,
      duration
    } = exam

    const availableTeachers = getOrderedAvailableTeachers(
      teachers,
      unavailableArrays,
      assignedExaminations,
      exam
    )

    const len = invigilators.length

    const selectedTeachers = []
    for (let i = 0; i < requiredInvigilators - len; i++) {
      const targetTeacher = availableTeachers[i]
      if (!targetTeacher) {
        console.error('No availableTeachers')
        console.error(exam)
        continue
      }

      const { teacher } = targetTeacher

      const senDuration = Math.ceil(duration * 1.25)

      updateSubstitutionNumber(
        teachers,
        teacher,
        classcode.match(/\d{1}S(R|T)?/) ? senDuration : duration,
        GENERAL_DUTIES.includes(classlevel)
      )
      selectedTeachers.push(teacher)
    }

    const found = assignedExaminations.find(
      ({ classcode, title, startDateTime }) => {
        return (
          classcode == exam.classcode &&
          title == exam.title &&
          startDateTime == exam.startDateTime
        )
      }
    )

    if (found) {
      found.invigilators.push(...selectedTeachers)
      return
    }

    exam['invigilators'].push(...selectedTeachers)
    assignedExaminations.push(exam)
  })

  console.log(assignedExaminations.length, 'examinations are assigned')

  checkAssignedCrashWithUnavailable(
    assignedExaminations,
    unavailableArrays,
    ignoredSlots
  )

  finalCheck(assignedExaminations)

  fs.writeFileSync(
    outputFilePath + '/result.json',
    JSON.stringify(
      _.sortBy(assignedExaminations, [
        'startDateTime',
        'classlevel',
        'classcode'
      ]),
      null,
      ''
    ),
    'utf8'
  )

  await printView(assignedExaminations, teachers)
}

main()

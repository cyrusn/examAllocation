require('dotenv').config()
const _ = require('lodash')
const { DateTime } = require('luxon')
const fs = require('fs')
const VERSION = 'v1.3.0'

const {
  GENERAL_DUTIES,
  getOrderedAvailableTeachers,
  updateSubstitutionNumber,
  finalCheck,
  checkAssignedCrashWithUnavailable
} = require('./helper.js')

const { getSheetData, appendRows, batchClearData } = require('./googleSheet.js')

const outputFilePath = './out'
const orderKeys = ['S1', 'S2', 'S1/S2', 'S3', 'S4', 'S5', 'S6', 'FI', 'G', 'SB']
const guardianceOrderKeys = ['DC', 'Hall', '1/F', '2/F', '3/F', '4/F']

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

  const groupedExaminations = assignedExaminations.reduce(
    (prev, assignedExamination) => {
      const {
        classlevel,
        classcode,
        title,
        startDateTime,
        duration,
        // requiredInvigilators,
        paperInCharges,
        location,
        invigilators
      } = assignedExamination
      const startDateTimeDT = DateTime.fromISO(startDateTime)
      const date = startDateTimeDT.toFormat('yyyy-MM-dd\n(EEE)')
      const startTime = startDateTimeDT.toFormat('HH:mm')
      // const endDateTimeDT = startDateTimeDT.plus({ minutes: duration })
      // const endTime = endDateTimeDT.toFormat('HH:mm')
      const time = `${startTime}`

      const secondKey =
        GENERAL_DUTIES.includes(classlevel) || classlevel == 'FI'
          ? classlevel
          : time

      const obj = {
        time,
        duration,
        classlevel,
        title,
        paperInCharges,
        classcodes: [{ classcode, location, invigilators, time, duration }]
      }

      if (!_.has(prev, [date])) {
        prev[date] = {
          [secondKey]: [obj]
        }
        return prev
      }

      if (!_.has(prev, [date, secondKey])) {
        prev[date][secondKey] = [obj]
        return prev
      }

      const found = prev[date][secondKey].find(
        (t) => t.title == title && t.classlevel == classlevel
      )

      if (found) {
        found.classcodes.push({
          classcode,
          location,
          invigilators,
          time,
          duration
        })
      } else {
        prev[date][secondKey].push(obj)
      }
      return prev
    },
    {}
  )

  const excelPrintView = [
    [
      'Date',
      'Time',
      'Duration\n(Extra)',
      'Form',
      'Subject',
      'Paper IC',
      'Location'
    ]
  ]
  const datekeys = _.keys(groupedExaminations)

  datekeys.sort().forEach((date) => {
    const secondKeys = _(groupedExaminations[date]).keys().sortBy()
    // .orderBy(() => {
    //   if (classlevel == 'SB') return 99
    //   if (classlevel == 'FI') return 98
    //   return parseInt(classlevel[1])
    // })

    secondKeys.forEach((secondKey, j) => {
      _(groupedExaminations[date][secondKey])
        .orderBy([
          secondKey,
          (c) => {
            return orderKeys.indexOf(c.classlevel)
          }
        ])
        .forEach((examSessions, i) => {
          const { classlevel, title, duration, paperInCharges, classcodes } =
            examSessions

          if (GENERAL_DUTIES.includes(secondKey) || secondKey == 'FI') {
            excelPrintView.push([
              j == 0 && i == 0 ? date : '',
              '',
              '',
              classlevel,
              title,
              paperInCharges?.join(', ') || '',
              '',
              ...(_(classcodes)
                .sortBy([
                  'time',
                  function (c) {
                    if (classlevel == 'G') {
                      return guardianceOrderKeys.indexOf(c.classcode)
                    }
                    return c.classcode
                  }
                ])
                .map(
                  ({ classcode, invigilators }) =>
                    `${classcode}\n${invigilators.join(', ')}`
                )
                .value() || [])
            ])
            return
          }

          const formattedDuration =
            classcodes.length > 1
              ? `${duration} (${Math.ceil(duration * 1.25)})`
              : `${duration}`

          let hallString = ''
          const hall = classcodes.find(
            ({ invigilators }) => invigilators.length > 2
          )

          if (hall) {
            _.pull(classcodes, hall)
            const { classcode, invigilators, location } = hall
            hallString = `${classcode} (${location ? location + ')\n' : ''}*${invigilators.join(', ')}`
          }

          excelPrintView.push([
            j == 0 && i == 0 ? date : '',
            secondKey,
            formattedDuration,
            classlevel,
            title,
            paperInCharges?.join(', ') || '',
            hallString,
            ...(_(classcodes)
              .map(
                ({ classcode, invigilators, location }) =>
                  `${classcode} (${location ? location + ')\n' : ''}${invigilators.join(', ')}`
              )
              .value() || [])
          ])
        })
    })
  })

  finalCheck(assignedExaminations)

  fs.writeFileSync(
    outputFilePath + '/grouped.json',
    JSON.stringify(groupedExaminations, null, '\t'),
    'utf8'
  )

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

  excelPrintView.push([[VERSION]])

  await appendRows(SPREADSHEET_ID, 'result!A:A', excelPrintView)
  await appendRows(
    SPREADSHEET_ID,
    'stat!A:A',
    teachers.reduce((prev, t, idx) => {
      const {
        teacher,
        originalSubstitutionNumber,
        substitutionNumber,
        totalInvigilationTime,
        occurrence,
        generalDuty,
        isSkip
      } = t
      if (idx == 0) {
        prev.push([
          'teacher',
          'originalSubstitutionNumber',
          'substitutionNumber',
          'totalInvigilationTime',
          'occurrence',
          'generalDuty'
        ])
      }
      prev.push([
        teacher,
        originalSubstitutionNumber,
        substitutionNumber,
        totalInvigilationTime,
        occurrence,
        generalDuty,
        isSkip
      ])
      return prev
    }, [])
  )
}

main()

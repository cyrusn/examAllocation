require('dotenv').config()
const _ = require('lodash')
const { DateTime } = require('luxon')
const VERSION = 'v1.0.1'

const { GENERAL_DUTIES, updateSubstitutionNumber } = require('./helper.js')

const { getSheetData, appendRows, batchClearData } = require('./googleSheet.js')
const orderKeys = ['S1', 'S2', 'S1/S2', 'S3', 'S4', 'S5', 'S6', 'FI', 'G', 'SB']
const guardianceOrderKeys = ['DC', 'Hall', '1/F', '2/F', '3/F', '4/F']

async function printTeacherView(assignedExaminations) {
  const SPREADSHEET_ID = process.env['SPREADSHEET_ID']
  await batchClearData(SPREADSHEET_ID, 'resultByTeacher!A:Z')

  const groupedExaminations = assignedExaminations.reduce(
    (prev, assignedExamination) => {
      const {
        classlevel,
        classcode,
        title,
        startDateTime,
        duration,
        paperInCharges,
        location,
        invigilators
      } = assignedExamination
      const startDateTimeDT = DateTime.fromISO(startDateTime)
      const date = startDateTimeDT.toFormat('yyyy-MM-dd')
      const startTime = startDateTimeDT.toFormat('HH:mm')
      const isSEN = classcode[1] == 'S'
      const mDuration = isSEN ? Math.ceil(duration * 1.25) : duration
      const endTime = startDateTimeDT
        .plus({ minutes: mDuration })
        .toFormat('HH:mm')

      const obj = {
        date,
        startTime,
        endTime,
        mDuration,
        classlevel,
        title,
        paperInCharges,
        classcode,
        invigilators,
        location
      }

      invigilators.forEach((invigilator) => {
        if (_.has(prev, [date, invigilator])) {
          prev[date][invigilator].push(obj)
          return
        }

        if (_.has(prev, date)) {
          prev[date][invigilator] = [obj]
          return
        }

        prev[date] = { [invigilator]: [obj] }
      })

      return prev
    },
    {}
  )

  const excelPrintView = [
    [
      'date',
      'invigilator',
      'startTime',
      'endTime',
      'classlevel',
      'classcode',
      'title',
      'duration',
      'location'
    ]
  ]

  const dateKeys = _.keys(groupedExaminations)

  dateKeys.forEach((date) => {
    const grouped = groupedExaminations[date]
    const teacherKeys = _.keys(grouped)

    teacherKeys.forEach((invigilator) => {
      grouped[invigilator].forEach((c) => {
        const {
          title,
          classcode,
          startTime,
          classlevel,
          endTime,
          location,
          mDuration
        } = c

        excelPrintView.push([
          date,
          invigilator,
          startTime,
          endTime,
          classlevel,
          classcode,
          title,
          mDuration,
          location || ''
        ])
      })
    })
  })
  await appendRows(SPREADSHEET_ID, 'resultByTeacher!A:A', excelPrintView)
}

async function printStat(assignedExaminations) {
  const SPREADSHEET_ID = process.env['SPREADSHEET_ID']
  await batchClearData(SPREADSHEET_ID, 'stat!A:Z')

  const rawTeachers = await getSheetData(SPREADSHEET_ID, 'teachers!A:D')
  const teachers = rawTeachers.map((t) => {
    t.originalSubstitutionNumber = parseInt(t.substitutionNumber) || 0
    t.substitutionNumber = parseInt(t.substitutionNumber) || 0
    t.totalInvigilationTime = 0
    t.generalDuty = 0
    t.occurrence = 0
    return t
  })

  assignedExaminations.forEach((exam) => {
    const { classlevel, classcode, duration, invigilators } = exam
    invigilators.forEach((invigilator) => {
      const senDuration = Math.ceil(duration * 1.25)
      const mDuration = classcode.match(/\d{1}S(R|T)?/) ? senDuration : duration
      const isGeneralDuty = GENERAL_DUTIES.includes(classlevel)

      updateSubstitutionNumber(teachers, invigilator, mDuration, isGeneralDuty)
    })
  })

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
          'generalDuty',
          'isSkip'
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

async function printView(assignedExaminations) {
  const SPREADSHEET_ID = process.env['SPREADSHEET_ID']
  await batchClearData(SPREADSHEET_ID, 'result!A:Z')

  const groupedExaminations = assignedExaminations.reduce(
    (prev, assignedExamination) => {
      const {
        session,
        classlevel,
        classcode,
        title,
        startDateTime,
        duration,
        paperInCharges,
        location,
        invigilators
      } = assignedExamination
      const startDateTimeDT = DateTime.fromISO(startDateTime)
      const date = startDateTimeDT.toFormat('yyyy-MM-dd\n(EEE)')
      const startTime = startDateTimeDT.toFormat('HH:mm')
      const time = `${startTime}`

      const secondKey =
        GENERAL_DUTIES.includes(classlevel) || classlevel == 'FI'
          ? classlevel
          : time

      const obj = {
        startDateTime,
        time,
        duration,
        session,
        classlevel,
        title,
        paperInCharges,
        classcodes: [
          { startDateTime, classcode, location, invigilators, time, duration }
        ]
      }
      if (!_.has(prev, [date])) {
        prev[date] = {}
      }

      if (!_.has(prev, [date, session])) {
        prev[date][session] = {}
      }

      if (!_.has(prev, [date, session, secondKey])) {
        prev[date][session][secondKey] = [obj]
        return prev
      }

      const found = prev[date][session][secondKey].find(
        (t) => t.title == title && t.classlevel == classlevel
      )

      if (found) {
        found.classcodes.push({
          startDateTime,
          classcode,
          location,
          invigilators,
          time,
          duration
        })
      } else {
        prev[date][session][secondKey].push(obj)
      }
      return prev
    },
    {}
  )

  const excelPrintView = [
    [
      'Date',
      'session',
      'Time',
      'Duration\n(Extra)',
      'Form',
      'Subject',
      'Paper IC',
      'Location',
      '',
      '',
      '',
      '',
      '',
      '',
      'SEN'
    ]
  ]

  const datekeys = _.keys(groupedExaminations)

  datekeys.sort().forEach((date) => {
    const sessions = _(groupedExaminations[date]).keys().sortBy()

    sessions.forEach((session, k) => {
      const secondKeys = _(groupedExaminations[date][session]).keys().sortBy()

      secondKeys.forEach((secondKey, j) => {
        _(groupedExaminations[date][session][secondKey])
          .orderBy([
            session,
            (c) => c.classlevel,
            (c) => {
              return orderKeys.indexOf(c.classlevel)
            },
            secondKey
          ])
          .forEach((examSession, i) => {
            const {
              startDateTime,
              classlevel,
              title,
              duration,
              paperInCharges,
              classcodes
            } = examSession

            if (GENERAL_DUTIES.includes(secondKey) || secondKey == 'FI') {
              excelPrintView.push([
                j == 0 && i == 0 && k == 0 ? date : '',
                '',
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

            const hasSEN = _.some(classcodes, function ({ classcode }) {
              return classcode[1] == 'S'
            })

            const formattedDuration = hasSEN
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

            const endTime = DateTime.fromISO(startDateTime)
              .plus({ minutes: duration })
              .toFormat('HH:mm')

            const extendEndTime = DateTime.fromISO(startDateTime)
              .plus({ minutes: Math.ceil(duration * 1.25) })
              .toFormat('HH:mm')

            const displayTime = hasSEN
              ? `${secondKey}-${endTime}\n(${extendEndTime})`
              : `${secondKey}-${endTime}`

            const specialExams =
              _(classcodes)
                .filter(({ classcode }) => {
                  return classcode[1] == 'S' || classcode[1] == 'N'
                })
                .sortBy([
                  ({ classcode }) => {
                    if (classcode[1] == 'N') return 'Z'
                    return classcode
                  }
                ])
                .value() || []

            const normalExams = classcodes.filter(({ classcode }) => {
              return classcode[1] != 'S' && classcode[1] != 'N'
            })

            const filledArray = new Array(6 - normalExams.length).fill('')

            const modifiyedClasscodes =
              specialExams.length > 0
                ? [...normalExams, ...filledArray, ...specialExams]
                : classcodes

            // if (j == 0 && i == 0) {
            //   excelPrintView.push([date])
            // }

            excelPrintView.push([
              j == 0 && i == 0 && k == 0 ? date : '',
              j == 0 && i == 0 ? `-${session}-` : '',
              displayTime,
              formattedDuration,
              classlevel,
              title,
              paperInCharges?.join(', ') || '',
              hallString,
              ...modifiyedClasscodes.map((exam) => {
                if (!exam) return ''
                const { classcode, invigilators, location } = exam
                return `${classcode} (${location ? location + ')\n' : ''}${invigilators.join(', ')}`
              })
            ])
          })
      })
    })
  })

  excelPrintView.push([[VERSION]])

  await appendRows(SPREADSHEET_ID, 'result!A:A', excelPrintView)
}

async function printSen(assignedExaminations) {
  const SPREADSHEET_ID = process.env['SPREADSHEET_ID']
  await batchClearData(SPREADSHEET_ID, 'SEN!A:Z')

  const groupedExaminations = assignedExaminations.reduce(
    (prev, assignedExamination) => {
      const {
        session,
        classlevel,
        classcode,
        title,
        startDateTime,
        duration,
        paperInCharges,
        location,
        invigilators
      } = assignedExamination
      const startDateTimeDT = DateTime.fromISO(startDateTime)
      const date = startDateTimeDT.toFormat('yyyy-MM-dd\n(EEE)')
      const startTime = startDateTimeDT.toFormat('HH:mm')
      const time = `${startTime}`

      const secondKey =
        GENERAL_DUTIES.includes(classlevel) || classlevel == 'FI'
          ? classlevel
          : time

      const obj = {
        startDateTime,
        time,
        duration,
        session,
        classlevel,
        title,
        paperInCharges,
        classcodes: [
          { startDateTime, classcode, location, invigilators, time, duration }
        ]
      }
      if (!_.has(prev, [date])) {
        prev[date] = {}
      }

      if (!_.has(prev, [date, session])) {
        prev[date][session] = {}
      }

      if (!_.has(prev, [date, session, secondKey])) {
        prev[date][session][secondKey] = [obj]
        return prev
      }

      const found = prev[date][session][secondKey].find(
        (t) => t.title == title && t.classlevel == classlevel
      )

      if (found) {
        found.classcodes.push({
          startDateTime,
          classcode,
          location,
          invigilators,
          time,
          duration
        })
      } else {
        prev[date][session][secondKey].push(obj)
      }
      return prev
    },
    {}
  )

  const excelPrintView = [
    [
      'Date',
      'session',
      'Time',
      'Duration\n(Extra)',
      'Form',
      'Subject',
      'Paper IC',
      'S',
      'SR',
      'ST'
    ]
  ]

  const datekeys = _.keys(groupedExaminations)

  datekeys.sort().forEach((date) => {
    const sessions = _(groupedExaminations[date]).keys().sortBy()

    sessions.forEach((session) => {
      const secondKeys = _(groupedExaminations[date][session]).keys().sortBy()

      secondKeys.forEach((secondKey) => {
        _(groupedExaminations[date][session][secondKey])
          .orderBy([
            session,
            (c) => c.classlevel,
            (c) => {
              return orderKeys.indexOf(c.classlevel)
            },
            secondKey
          ])

          .forEach((examSession) => {
            const {
              startDateTime,
              classlevel,
              title,
              duration,
              paperInCharges,
              classcodes
            } = examSession

            if (
              GENERAL_DUTIES.includes(secondKey) ||
              secondKey == 'FI' ||
              title == 'SSTU'
            ) {
              return
            }

            const hasSEN = _.some(classcodes, function ({ classcode }) {
              return classcode[1] == 'S'
            })

            const formattedDuration = hasSEN
              ? `${duration} (${Math.ceil(duration * 1.25)})`
              : `${duration}`

            const endTime = DateTime.fromISO(startDateTime)
              .plus({ minutes: duration })
              .toFormat('HH:mm')

            const extendEndTime = DateTime.fromISO(startDateTime)
              .plus({ minutes: Math.ceil(duration * 1.25) })
              .toFormat('HH:mm')

            const displayTime = hasSEN
              ? `${secondKey}-${endTime}\n(${extendEndTime})`
              : `${secondKey}-${endTime}`

            const specialExams =
              _(classcodes)
                .filter(({ classcode }) => {
                  return classcode[1] == 'S' || classcode[1] == 'N'
                })
                .sortBy([
                  ({ classcode }) => {
                    if (classcode[1] == 'N') return 'Z'
                    return classcode
                  }
                ])
                .value() || []

            excelPrintView.push([
              date,
              `-${session}-`,
              displayTime,
              formattedDuration,
              classlevel,
              title,
              paperInCharges?.join(', ') || '',
              ...specialExams.map(
                ({ location, invigilators }) =>
                  `${location}\n${invigilators.join(', ')}`
              )
            ])
          })
      })
    })
  })

  excelPrintView.push([[VERSION]])

  console.log('running sen')
  await appendRows(SPREADSHEET_ID, 'SEN!A:A', excelPrintView)
}

module.exports = {
  printView,
  printTeacherView,
  printStat,
  printSen
}

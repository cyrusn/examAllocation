const _ = require('lodash')
const { DateTime } = require('luxon')
const { GENERAL_DUTIES, VERSION } = require('../constants')
const { getSenDuration } = require('../utils')
const { appendRows, batchClearData } = require('../googleSheet')

const orderKeys = ['S1', 'S2', 'S1/S2', 'S3', 'S4', 'S5', 'S6', 'FI', 'G', 'SB']

async function printSen(assignedExaminations) {
  const SPREADSHEET_ID = process.env['SPREADSHEET_ID']
  await batchClearData(SPREADSHEET_ID, 'SEN!A:Z')

  const groupedExaminations = assignedExaminations.reduce(
    (prev, assignedExamination) => {
      const {
        id,
        session,
        classlevel,
        classcode,
        title,
        startDateTime,
        duration,
        paperInCharges,
        location
      } = assignedExamination
      const invigilators = _.uniq(assignedExamination.invigilators)

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
      'ST',
      'NCS'
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
              return classcode[1] == 'S' || classcode[1] == 'N'
            })

            const formattedDuration = hasSEN
              ? `${duration} (${getSenDuration(examSession)})` 
              : `${duration}`

            const endTime = DateTime.fromISO(startDateTime)
              .plus({ minutes: duration })
              .toFormat('HH:mm')

            const extendEndTime = DateTime.fromISO(startDateTime)
              .plus({ minutes: getSenDuration(examSession) })
              .toFormat('HH:mm')

            const displayTime = hasSEN
              ? `${secondKey}-${endTime}\n(${extendEndTime})` 
              : `${secondKey}-${endTime}`

            const senTypes = [
              ['S', 'S/SR', 'S/SR粵', 'S/SR普'],
              ['SR'],
              ['ST', 'ST-1', 'ST-2'],
              ['NCS']
            ]

            const specialExams = senTypes.map((types) => {
              const result = _.filter(classcodes, ({ classcode }) => {
                return types.some((type) => {
                  return classcode == `${classlevel[1]}${type}`
                })
              })

              return result
            })

            excelPrintView.push([
              date,
              `-${session}-`,
              displayTime,
              formattedDuration,
              classlevel,
              title,
              paperInCharges?.join(', ') || '',
              ...specialExams.map((exams) =>
                exams
                  .map(
                    ({ location, invigilators }) =>
                      `${location}\n${invigilators.join(', ')}`
                  )
                  .join('\n')
              )
            ])
          })
      })
    })
  })

  excelPrintView.push([[VERSION]])

  console.log('Printing SEN')
  await appendRows(SPREADSHEET_ID, 'SEN!A:A', excelPrintView)
}

module.exports = { printSen }
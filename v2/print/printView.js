const _ = require('lodash')
const { DateTime } = require('luxon')
const { GENERAL_DUTIES, VERSION } = require('../constants')
const { getSenDuration } = require('../utils')
const { appendRows, batchClearData } = require('../googleSheet')

const orderKeys = ['S1', 'S2', 'S1/S2', 'S3', 'S4', 'S5', 'S6', 'FI', 'G', 'SB']
const guardianceOrderKeys = ['DC', 'Hall', '1/F', '2/F', '3/F', '4/F']

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

            const formattedDuration = `${duration} (${getSenDuration(examSession)})`

            let hallString = ''
            const hall = classcodes.find(({ location }) => {
              const hallGroup = [
                'HALL',
                '1/F',
                '2/F',
                '3/F',
                '4/F',
                '5/F',
                'IS LAB'
              ]
              return hallGroup.includes(location)
            })

            if (hall) {
              _.pull(classcodes, hall)
              const { classcode, invigilators, location } = hall
              hallString = `${classcode} (${location ? location + ')\n' : ''}*${invigilators.join(', ')}`
            }

            const endTime = DateTime.fromISO(startDateTime)
              .plus({ minutes: duration })
              .toFormat('HH:mm')

            const extendEndTime = DateTime.fromISO(startDateTime)
              .plus({ minutes: getSenDuration(examSession) })
              .toFormat('HH:mm')

            const displayTime = `${secondKey}-${endTime}\n(${extendEndTime})`

            const specialExams = _(
              classcodes
            )
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

  console.log('Printing Exam View')
  await appendRows(SPREADSHEET_ID, 'result!A:A', excelPrintView)
}

module.exports = { printView }
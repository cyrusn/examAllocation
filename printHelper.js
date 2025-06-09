require('dotenv').config()
const _ = require('lodash')
const { DateTime } = require('luxon')
const VERSION = 'v1.3.0'

const { GENERAL_DUTIES } = require('./helper.js')

const { appendRows } = require('./googleSheet.js')
const orderKeys = ['S1', 'S2', 'S1/S2', 'S3', 'S4', 'S5', 'S6', 'FI', 'G', 'SB']
const guardianceOrderKeys = ['DC', 'Hall', '1/F', '2/F', '3/F', '4/F']

async function printView(assignedExaminations, teachers) {
  const SPREADSHEET_ID = process.env['SPREADSHEET_ID']

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
      const time = `${startTime}`

      const secondKey =
        GENERAL_DUTIES.includes(classlevel) || classlevel == 'FI'
          ? classlevel
          : time

      const obj = {
        startDateTime,
        time,
        duration,
        classlevel,
        title,
        paperInCharges,
        classcodes: [
          { startDateTime, classcode, location, invigilators, time, duration }
        ]
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
          startDateTime,
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

    secondKeys.forEach((secondKey, j) => {
      _(groupedExaminations[date][secondKey])
        .orderBy([
          secondKey,
          (c) => {
            return orderKeys.indexOf(c.classlevel)
          }
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

          excelPrintView.push([
            j == 0 && i == 0 ? date : '',
            displayTime,
            formattedDuration,
            classlevel,
            title,
            paperInCharges?.join(', ') || '',
            hallString,
            ...(_(classcodes)
              .sortBy(['classcode'])
              .map(
                ({ classcode, invigilators, location }) =>
                  `${classcode} (${location ? location + ')\n' : ''}${invigilators.join(', ')}`
              )
              .value() || [])
          ])
        })
    })
  })

  excelPrintView.push([[VERSION]])

  await appendRows(SPREADSHEET_ID, 'result!A:A', excelPrintView)
  if (teachers) {
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
}
module.exports = {
  printView
}

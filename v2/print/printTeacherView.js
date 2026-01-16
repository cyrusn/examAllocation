const _ = require('lodash')
const { DateTime } = require('luxon')
const { getSenDuration } = require('../utils')
const { appendRows, batchClearData } = require('../googleSheet')

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
        paperInCharges,
        location,
        invigilators
      } = assignedExamination
      const startDateTimeDT = DateTime.fromISO(startDateTime)
      const date = startDateTimeDT.toFormat('yyyy-MM-dd')
      const startTime = startDateTimeDT.toFormat('HH:mm')
      const mDuration = getSenDuration(assignedExamination)
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
  console.log('Printing ResultByTeacher')
  await appendRows(SPREADSHEET_ID, 'resultByTeacher!A:A', excelPrintView)
}

module.exports = { printTeacherView }

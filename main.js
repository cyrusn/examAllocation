const _ = require('lodash')
const { DateTime, Duration, Interval } = require('luxon')
const fs = require('fs')
const {
  getOrderedAvailableTeachers,
  updateCoveringNumber,
  checkAssignedCrashWithUnavailable
} = require('./helper.js')

const { getSheetData, appendRows, batchClearData } = require('./googleSheet.js')

const outputFilePath = './out'
const ignoredSlots = [
  {
    teacher: 'HYH',
    start: '2025-06-16T09:15:00',
    end: '2025-06-16T10:15:00',
    remark: 'VA 同 KPF take turn'
  },
  {
    teacher: 'MC',
    start: '2025-06-19T09:15:00',
    end: '2025-06-19T10:15:00',
    remark: '同 Science 老師夾'
  },
  {
    teacher: 'SMT',
    start: '2025-06-19T09:15:00',
    end: '2025-06-19T10:15:00',
    remark: '同 Science 老師夾'
  },
  {
    teacher: 'YIL',
    start: '2025-06-06T08:00:00',
    end: '2025-06-06T08:45:00',
    remark: 'JC 可以頂2B 班主任節'
  }
]

const main = async () => {
  const spreadsheetId = '1_n44uMCjAaarqXxtBWQ_t52Cwnf5R_WVx9SFXvOcxXE'
  // clear result sheet first
  await batchClearData(spreadsheetId, 'result!A:Z')
  await batchClearData(spreadsheetId, 'stat!A:Z')
  const rawExaminations = await getSheetData(spreadsheetId, 'exam!A:I')
  const rawUnavailables = await getSheetData(spreadsheetId, 'unavailables!A:C')
  const rawTeachers = await getSheetData(spreadsheetId, 'teachers!A:C')

  const teachers = rawTeachers
    .map((t) => {
      t.coveringNumber = parseInt(t.coveringNumber)
      t.net = 0
      return t
    })
    .filter(({ isSkip }) => isSkip == undefined)

  // console.log(teachers)

  const examinations = rawExaminations.reduce((prev, exam) => {
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
    const { invigilators, duration } = exam
    invigilators.forEach((invigilator) => {
      updateCoveringNumber(teachers, invigilator, duration)
    })
  })

  _(examinations)
    .orderBy(['invigilators', 'duration'], ['asc', 'desc'])
    .forEach((exam) => {
      const { requiredInvigilators, invigilators, duration } = exam

      const availableTeachers = getOrderedAvailableTeachers(
        teachers,
        unavailableArrays,
        assignedExaminations,
        exam
      )

      const len = invigilators.length
      const found = assignedExaminations.find(
        ({ classcode, title, startDateTime }) => {
          return (
            classcode == exam.classcode &&
            title == exam.title &&
            startDateTime == exam.startDateTime
          )
        }
      )

      const selectedTeachers = []
      for (let i = 0; i < requiredInvigilators - len; i++) {
        const targetTeacher = availableTeachers[i]
        const { teacher } = targetTeacher

        updateCoveringNumber(teachers, teacher, duration)
        selectedTeachers.push(teacher)
      }

      if (found) {
        found.invigilators.push(...selectedTeachers)
      } else {
        exam['invigilators'].push(...selectedTeachers)
        assignedExaminations.push(exam)
      }
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
      const date = startDateTimeDT.toFormat('yyyy-MM-dd (EEE)')
      const startTime = startDateTimeDT.toFormat('HH:mm')
      const endDateTimeDT = startDateTimeDT.plus({ minutes: duration })
      const endTime = endDateTimeDT.toFormat('HH:mm')
      const time = `${startTime}-${endTime}`

      if (!_.has(prev, [date])) {
        prev[date] = {
          [classlevel]: [
            {
              time,
              title,
              paperInCharges,
              classcodes: [{ classcode, location, invigilators }]
            }
          ]
        }
        return prev
      }

      if (!_.has(prev, [date, classlevel])) {
        prev[date][classlevel] = [
          {
            time,
            title,
            paperInCharges,
            classcodes: [{ classcode, location, invigilators }]
          }
        ]
        return prev
      }

      const found = prev[date][classlevel].find(
        (t) => t.time == time && t.title == title
      )
      if (found) {
        found.classcodes.push({ classcode, location, invigilators })
      } else {
        prev[date][classlevel].push({
          time,
          title,
          paperInCharges,
          classcodes: [{ classcode, location, invigilators }]
        })
      }
      return prev
    },
    {}
  )

  const excelPrintView = []
  const datekeys = _.keys(groupedExaminations)

  datekeys.forEach((date) => {
    const classlevelKeys = _.keys(groupedExaminations[date]).sort()

    classlevelKeys.forEach((classlevel) => {
      _(groupedExaminations[date][classlevel])
        .orderBy('time')
        .forEach((examSessions, i) => {
          const { time, title, paperInCharges, classcodes } = examSessions
          let hallString = ''
          const hall = classcodes.find(
            ({ invigilators }) => invigilators.length > 2
          )
          if (hall) {
            _.pull(classcodes, hall)
            const { classcode, invigilators, location } = hall
            hallString = `${classcode}\n${location}\n*${invigilators.join(', ')}`
          }
          excelPrintView.push([
            i == 0 ? date : '',
            time,
            classlevel,
            title,
            paperInCharges?.join(', ') || '',
            hallString,
            ...(classcodes?.map(
              ({ classcode, invigilators, location }) =>
                `${classcode}\n${location}\n${invigilators.join(', ')}`
            ) || [])
          ])
        })
    })
  })

  await appendRows(spreadsheetId, 'result!A:A', excelPrintView)
  await appendRows(
    spreadsheetId,
    'stat!A:A',
    teachers.reduce((prev, t, idx) => {
      const { teacher, coveringNumber, net } = t
      if ((idx = 0)) {
        prev.push(['teacher', 'coveringNumber', 'net', 'isSkip'])
      }
      prev.push([teacher, coveringNumber, net])
      return prev
    }, [])
  )
  // fs.writeFileSync(
  //   outputFilePath + '/grouped.json',
  //   JSON.stringify(groupedExaminations, null, '\t'),
  //   'utf8'
  // )

  // fs.writeFileSync(
  //   outputFilePath + '/teachers.json',
  //   JSON.stringify(teachers, null, '\t'),
  //   'utf8'
  // )
  //
  // fs.writeFileSync(
  //   outputFilePath + '/result.json',
  //   JSON.stringify(
  //     _.sortBy(assignedExaminations, [
  //       'startDateTime',
  //       'classlevel',
  //       'classcode'
  //     ]),
  //     null,
  //     ''
  //   ),
  //   'utf8'
  // )
}

main()

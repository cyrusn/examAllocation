const _ = require('lodash')

const { DateTime, Duration, Interval } = require('luxon')
const GENERAL_DUTIES = ['SB', 'G']
const DC_TEAM_MEMBERS = ['JT', 'MKC', 'HYH', 'WTN', 'CSC', 'OSL', 'KYL', 'TCL']
const TEACHER_ASSISTANTS = ['OLN', 'WHS', 'WYY', 'EC', 'KYY', 'CKL', 'LS']
const SKIP_CHECK_EXAMINATIONS = [
  { classlevel: 'S2', title: 'IS PRACTICAL' },
  { classlevel: 'S1', title: 'IS PRACTICAL' }
]
const BUFFER_TIME = 15
const F6_BUFFER_TIME = 15
const PREFERED_RATE = 0.5
const F1_F5_EXAM_PERIOD = '2026-01-06T00:00:00/2026-01-15T23:59:59'
const F6_EXAM_PERIOD = '2026-01-19T00:00:00/2026-01-30T23:59:59'

function getIntervalBySlot(slot) {
  const { start, end } = slot
  const startDT = DateTime.fromISO(start)
  const endDT = DateTime.fromISO(end)

  return Interval.fromDateTimes(startDT, endDT)
}

function getSenDuration(exam) {
  // return exam.title.toUpperCase().replace('.', '').includes('VA')
  //   ? Math.ceil(exam.duration * 1.05)
  //   : Math.ceil(exam.duration * 1.25)
  return Math.ceil(exam.duration * 1.25)
}

function getExamInterval(exam) {
  const { startDateTime, duration, classcode, classlevel } = exam
  const examStartDateTime = DateTime.fromISO(startDateTime)
  const senDuration = getSenDuration(exam)
  const examDuration = classcode.match(/\d{1}S(R|T)?/) ? senDuration : duration

  if (GENERAL_DUTIES.includes(classlevel)) {
    return Interval.after(
      examStartDateTime.minus({
        minutes: classcode.includes('6') ? F6_BUFFER_TIME : BUFFER_TIME
      }),
      Duration.fromObject({
        minutes:
          senDuration +
          (classcode.includes('6') ? F6_BUFFER_TIME : BUFFER_TIME) * 2
      })
    )
  }

  return Interval.after(
    examStartDateTime.minus({
      minutes: classcode.includes('6') ? F6_BUFFER_TIME : BUFFER_TIME
    }),
    Duration.fromObject({
      minutes:
        examDuration +
        (classcode.includes('6') ? F6_BUFFER_TIME : BUFFER_TIME) * 2
    })
  )
}

function updateSubstitutionNumber(teachers, invigilator, exam) {
  const found = teachers.find((l) => l.teacher == invigilator)

  const senDuration = getSenDuration(exam)
  const duration = exam.classcode.match(/\d{1}S(R|T)?/)
    ? senDuration
    : exam.duration

  const { session, startDateTime, location } = exam

  let timeAdded = 0
  let generalDuty = 0

  timeAdded = duration
  if (GENERAL_DUTIES.includes(exam.classlevel)) {
    generalDuty = 1
    if (exam.classlevel == 'G') timeAdded = 30
  }

  if (!found) {
    teachers.push({
      teacher: invigilator,
      totalInvigilationTime: timeAdded,
      generalDuty: generalDuty,
      occurrence: 1,
      isSkip: true,
      exams: [{ session, startDateTime, location, timeAdded }]
    })
    return
  }

  if (!found.exams) {
    found.exams = []
  }

  const countedExam = found.exams.find((e) => {
    return (
      e.session == session &&
      e.location == location &&
      e.startDateTime.slice(0, 10) == startDateTime.slice(0, 10)
    )
  })

  if (countedExam) return

  found.occurrence += 1
  found.totalInvigilationTime += timeAdded
  found.generalDuty += generalDuty

  found.exams.push({
    session,
    startDateTime,
    location,
    timeAdded
  })
}

function checkAssignedCrashWithUnavailable(
  assignedExamination,
  unavailableArrays,
  ignoredSlots
) {
  const crashedExams = []
  assignedExamination.forEach((assignedExam) => {
    const { invigilators } = assignedExam
    const examInterval = getExamInterval(assignedExam)

    invigilators.forEach((invigilator) => {
      unavailableArrays.forEach((unavailable) => {
        const { teachers, slots, remark } = unavailable

        if (!teachers.includes(invigilator)) return

        slots.forEach((slot) => {
          const unavailableInterval = getIntervalBySlot(slot)
          if (!unavailableInterval.isValid) {
            console.log(unavailableInterval)
            console.log(unavailable)
            console.log(slot)
            throw new Error('invalid unavailable')
          }

          if (examInterval.overlaps(unavailableInterval)) {
            const { start, end } = slot
            const found = ignoredSlots.find(
              (t) =>
                t.teacher == invigilator && t.start == start && t.end == end
            )
            if (found) return
            crashedExams.push({ assignedExam, invigilator, slot, remark })
          }
        })
      })
    })
  })

  if (crashedExams.length > 0) {
    crashedExams.forEach((exam) => {
      // console.error(exam)
      const { id, classcode, title, startDateTime, duration } =
        exam.assignedExam
      console.error(id, classcode, title, startDateTime, duration)
      console.log(exam.invigilator, exam.slot.start, exam.slot.end, exam.remark)
    })
    throw new Error("Assigned exam crashed with teacher's availablity.")
  }
}

function getNoOfLessonInPeriodByTeacher(unavailableArrays, exam) {
  const F1_F5_EXAM_PERIOD_INTERVAL = Interval.fromISO(F1_F5_EXAM_PERIOD)
  const F6_EXAM_PERIOD_INTERVAL = Interval.fromISO(F6_EXAM_PERIOD)
  const examInterval = getExamInterval(exam)

  const result = _(unavailableArrays).reduce((prev, unavailable) => {
    const { teachers, slots, remark } = unavailable
    if (!/D\dP\d/.test(remark)) return prev

    let Period
    switch (true) {
      case examInterval.overlaps(F1_F5_EXAM_PERIOD_INTERVAL):
        Period = F1_F5_EXAM_PERIOD_INTERVAL
        break
      case examInterval.overlaps(F6_EXAM_PERIOD_INTERVAL):
        Period = F6_EXAM_PERIOD_INTERVAL
        break
    }
    if (!Period) return prev

    teachers.forEach((teacher) => {
      if (!(teacher in prev)) prev[teacher] = 0

      slots.forEach((slot) => {
        const unavailableInterval = getIntervalBySlot(slot)

        if (
          unavailableInterval.overlaps(Period) &&
          teachers.includes(teacher)
        ) {
          prev[teacher] += 1
        }
      })
    })
    return prev
  }, {})
  return result
}

function getOrderedAvailableTeachers(
  teachers,
  unavailableArrays,
  assignedExaminations,
  exam
) {
  const {
    startDateTime,
    title,
    classlevel,
    preferedTeachers,
    noOfLessonInPeriodByTeacher
  } = exam
  // console.log( startDateTime, title, classlevel)
  const examInterval = getExamInterval(exam)
  const examStartTime = DateTime.fromISO(exam.startDateTime)
  const clonedTeachers = [...teachers]

  // if (classlevel == 'S1' || classlevel == 'S6') {
  //   console.log(classlevel, title, noOfLessonInPeriodByTeacher)
  // }

  const noOfLessonOnTheExamDayByTeacher = _(unavailableArrays).reduce(
    (prev, unavailable) => {
      const { teachers, slots, remark } = unavailable
      if (!/D\dP\d/.test(remark)) return prev

      teachers.forEach((teacher) => {
        if (!(teacher in prev)) prev[teacher] = 0
        slots.forEach((slot) => {
          const unavailableStartTime = DateTime.fromISO(slot.start)

          if (
            examStartTime.hasSame(unavailableStartTime, 'day') &&
            teachers.includes(teacher)
          ) {
            prev[teacher] += 1
          }
        })
      })
      return prev
    },
    {}
  )

  assignedExaminations.forEach((exam) => {
    const { invigilators } = exam
    invigilators.forEach((invigilator) => {
      updateSubstitutionNumber(clonedTeachers, invigilator, exam)
    })
  })

  const orderedAvailableTeachers = _(clonedTeachers)
    .filter((t) => {
      const { teacher, isSkip, maxLoading, occurrence } = t
      if (maxLoading && maxLoading <= occurrence) return false
      if (isSkip != undefined) return false

      // TA and DC members Do not need to have General Duties
      if (
        [...GENERAL_DUTIES].includes(classlevel) &&
        [...TEACHER_ASSISTANTS, ...DC_TEAM_MEMBERS].includes(teacher)
      )
        return false

      // Check teachers has assigned
      const isAssigned = _(assignedExaminations).some((assignedExam) => {
        const { invigilators } = assignedExam

        // the teacher is already assigned in same examination
        if (!invigilators.includes(teacher)) return false

        const assignedExamInterval = getExamInterval(assignedExam)
        return examInterval.overlaps(assignedExamInterval)
      })

      // check not more than 2 invigilation per day
      // const isTooMuchInvigilotion = false
      const isTooMuchInvigilotion =
        _(assignedExaminations)
          .filter((assignedExam) => {
            const assignedStartDateTime = DateTime.fromISO(
              assignedExam.startDateTime
            )
            return (
              assignedExam.invigilators.includes(teacher) &&
              DateTime.fromISO(exam.startDateTime).hasSame(
                assignedStartDateTime,
                'day'
              )
            )
          })
          .value().length > 2

      const noOfLessonOnTheExamDay = noOfLessonOnTheExamDayByTeacher[teacher]

      // check if teachers in unavailableArrays
      const isUnavailable = _.some(unavailableArrays, (unavailable) => {
        // if the teacher has no information in unavailables

        const { teachers, slots } = unavailable

        if (!teachers.includes(teacher)) return false

        return _.some(slots, (slot) => {
          const unavailableInterval = getIntervalBySlot(slot)
          return examInterval.overlaps(unavailableInterval)
        })
      })

      // if (exam.id == '7021-1' && teacher == 'YML') {
      //   console.log(isUnavailable)
      // }

      const result = !(
        isUnavailable ||
        isAssigned ||
        isTooMuchInvigilotion ||
        noOfLessonOnTheExamDay > 4
      )
      // console.log(
      //   t.teacher,
      //   result,
      //   isUnavailable,
      //   isAssigned,
      //   isTooMuchInvigilotion,
      //   noOfLessonOnTheExamDay > 4
      // )
      return result
    })
    .value()

  function orderTotalInvigilationTime(t) {
    const noOfLessonInPeriod = noOfLessonInPeriodByTeacher[t.teacher] || 0
    const result = (t.totalInvigilationTime + noOfLessonInPeriod * 55) / 120

    if (preferedTeachers.includes(t.teacher)) {
      return Math.round(result * PREFERED_RATE)
    }

    return Math.round(result) || 0
  }

  if ([...GENERAL_DUTIES, 'FI'].includes(classlevel)) {
    return _.orderBy(
      orderedAvailableTeachers,
      ['generalDuty', 'occurrence', orderTotalInvigilationTime],
      ['asc', 'asc', 'asc']
    )
  }

  const result = _.orderBy(
    orderedAvailableTeachers,
    [orderTotalInvigilationTime, 'occurrence', 'generalDuty'],
    ['asc', 'asc', 'asc']
  )

  // result.forEach((t, index) => {
  //   if (t.teacher !== 'PUL') return
  //   console.log(t.teacher, t.totalInvigilationTime, index)
  // })
  return result
}

function finalCheck(assignedExaminations) {
  console.log('Validating...')
  assignedExaminations.forEach(function (examA, i, assignedExaminations) {
    const { classlevel, classcode, title } = examA
    if (
      SKIP_CHECK_EXAMINATIONS.some((exam) =>
        exam.classlevel == classlevel && exam.title == title && exam.classcode
          ? exam.classcode == classcode
          : true
      )
    ) {
      return false
    }

    const examIntervalA = getExamInterval(examA)
    assignedExaminations.forEach(function (examB, j) {
      if (i >= j) return false
      const examIntervalB = getExamInterval(examB)

      if (examIntervalA.overlaps(examIntervalB)) {
        const intersection = _(examA.invigilators)
          .intersection(examB.invigilators)
          .difference(TEACHER_ASSISTANTS)
          .value()

        if (intersection.length) {
          console.log(examA, examB)
          console.log(intersection, '\n\n')
        }
        return intersection.length > 0
      }
      return false
    })
  })
  console.log('Validation completed')
}

function progressLog(progress) {
  const barWidth = 30
  const filledWidth = Math.ceil(progress * barWidth)
  const emptyWidth = barWidth - filledWidth
  const progressBar = '█'.repeat(filledWidth) + '▒'.repeat(emptyWidth)
  const result = `[${progressBar}] ${Math.ceil(progress * 100)}%`
  process.stdout.clearLine()
  process.stdout.cursorTo(0)
  process.stdout.write(`Progress: ${result}`)
  if (progress == 1) console.log()
}

module.exports = {
  getOrderedAvailableTeachers,
  updateSubstitutionNumber,
  checkAssignedCrashWithUnavailable,
  finalCheck,
  getSenDuration,
  progressLog,
  getNoOfLessonInPeriodByTeacher,
  GENERAL_DUTIES
}

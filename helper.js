const _ = require('lodash')

const { DateTime, Duration, Interval } = require('luxon')
const GENERAL_DUTIES = ['SB', 'G']
const DC_TEAM_MEMBERS = ['JT', 'MKC', 'HYH', 'WTN', 'CSC']
const TEACHER_ASSISTANTS = ['OLN', 'WHS', 'WYY', 'EC', 'KYY', 'CKL']
const SKIP_CHECK_EXAMINATIONS = [
  { classlevel: 'S2', title: 'IS (LAB)' },
  { classlevel: 'S1', title: 'IS (LAB)' }
]
const BUFFER_TIME = 15

function getIntervalBySlot(slot) {
  const { start, end } = slot
  const startDT = DateTime.fromISO(start)
  const endDT = DateTime.fromISO(end)

  return Interval.fromDateTimes(startDT, endDT)
}

function getExamInterval(exam) {
  const { startDateTime, duration, classcode, classlevel } = exam
  const examStartDateTime = DateTime.fromISO(startDateTime)
  const senDuration = Math.ceil(duration * 1.25)
  const examDuration = classcode.match(/\d{1}S(R|T)?/) ? senDuration : duration

  if (GENERAL_DUTIES.includes(classlevel)) {
    return Interval.after(
      examStartDateTime,
      Duration.fromObject({ minutes: examDuration })
    )
  }

  return Interval.after(
    examStartDateTime.minus({ minutes: BUFFER_TIME }),
    Duration.fromObject({ minutes: examDuration + BUFFER_TIME * 2 })
  )
}

function updateSubstitutionNumber(
  teachers,
  invigilator,
  duration,
  isGeneralDuty
) {
  const found = teachers.find((l) => l.teacher == invigilator)
  const addedSubstitutionNumber = Math.max(
    0.5,
    Math.round((parseInt(duration) * 2) / 55) / 2
  )

  if (!found) {
    teachers.push({
      teacher: invigilator,
      substitutionNumber: addedSubstitutionNumber,
      totalInvigilationTime: addedSubstitutionNumber,
      generalDuty: 1,
      occurrence: 1,
      isSkip: true
    })
    return
  }

  found.occurrence += 1
  if (!isGeneralDuty) {
    found.substitutionNumber += addedSubstitutionNumber
    found.totalInvigilationTime += addedSubstitutionNumber
  } else {
    found.generalDuty += 1
  }
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
            if (found) {
              // console.warn({
              //   assignedExam,
              //   found,
              //   unavailable: { invigilator, slot, remark }
              // })
              return
            }
            crashedExams.push({ assignedExam, invigilator, slot, remark })
          }
        })
      })
    })
  })

  if (crashedExams.length > 0) {
    crashedExams.forEach((exam) => console.error(exam))
    throw new Error("Assigned exam crashed with teacher's availablity.")
  }
}

function getOrderedAvailableTeachers(
  teachers,
  unavailableArrays,
  assignedExaminiations,
  exam
) {
  const { classlevel } = exam

  const examInterval = getExamInterval(exam)

  const orderedAvailableTeachers = _(teachers)
    .filter((t) => {
      const { teacher, isSkip, maxLoading, occurrence } = t
      if (maxLoading && maxLoading <= occurrence) return false
      if (isSkip != undefined) return false

      // TA and DC members Do not need to have General Duties
      if (
        GENERAL_DUTIES.includes(classlevel) &&
        [...TEACHER_ASSISTANTS, ...DC_TEAM_MEMBERS].includes(teacher)
      )
        return false

      // Check teachers has assigned
      const isAssigned = _(assignedExaminiations).some((assignedExam) => {
        const { invigilators } = assignedExam

        // the teacher is already assigned in same examination
        if (!invigilators.includes(teacher)) return false

        const assignedExamInterval = getExamInterval(assignedExam)
        return examInterval.overlaps(assignedExamInterval)
      })

      // check not more than 2 invigilation per day
      const isTooMuchInvigilotion =
        _(assignedExaminiations)
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
          .value().length >= 2

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

      return !(isUnavailable || isAssigned || isTooMuchInvigilotion)
    })
    .value()

  if (GENERAL_DUTIES.includes(classlevel)) {
    return _.sortBy(orderedAvailableTeachers, [
      'generalDuty',
      'occurrence',
      'totalInvigilationTime',
      'substitutionNumber'
    ])
  }

  return _.sortBy(orderedAvailableTeachers, [
    'substitutionNumber',
    'totalInvigilationTime',
    'occurrence',
    'generalDuty'
  ])
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

module.exports = {
  getOrderedAvailableTeachers,
  updateSubstitutionNumber,
  checkAssignedCrashWithUnavailable,
  finalCheck,
  GENERAL_DUTIES
}

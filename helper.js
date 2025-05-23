const _ = require('lodash')

const { DateTime, Duration, Interval } = require('luxon')
const GENERAL_DUTIES = ['SB', 'G']
const DC_TEAM_MEMBERS = ['JT', 'MKC', 'HYH', 'WTN', 'CSC']
const EXCLUSED_STANDBY_TEACHERS = ['OLN', 'WHS', 'WYY', 'EC', 'KYY', 'CKL']

function updateCoveringNumber(list, teacher, duration, isGeneralDuty) {
  const found = list.find((l) => l.teacher == teacher)
  const addedCoveringNumber = Math.max(
    0.5,
    Math.round((parseInt(duration) * 2) / 55) / 2
  )

  if (!found) {
    list.push({
      teacher,
      coveringNumber: addedCoveringNumber,
      totalInvigilationTime: addedCoveringNumber,
      generalDuty: 1,
      occurrence: 1,
      isSkip: true
    })
    return
  }

  found.occurrence += 1
  if (!isGeneralDuty) {
    found.coveringNumber += addedCoveringNumber
    found.totalInvigilationTime += addedCoveringNumber
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
    const { startDateTime, duration, invigilators } = assignedExam
    const examInterval = Interval.after(
      DateTime.fromISO(startDateTime),
      Duration.fromObject({ minutes: duration })
    )
    invigilators.forEach((invigilator) => {
      unavailableArrays.forEach((unavailable) => {
        const { teachers, slots, remark } = unavailable

        if (!teachers.includes(invigilator)) return
        slots.forEach((slot) => {
          const { start, end } = slot

          const startDT = DateTime.fromISO(start)
          const endDT = DateTime.fromISO(end)

          const unavailableInterval = Interval.fromDateTimes(startDT, endDT)

          if (examInterval.overlaps(unavailableInterval)) {
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
    console.error(crashedExams)
    throw new Error("Assigned exam crashed with teacher's availablity.")
  }
}

function getOrderedAvailableTeachers(
  teachers,
  unavailableArrays,
  assignedExaminiations,
  exam
) {
  const bufferDuration = {
    minutes: 15
  }
  const { startDateTime, duration, classlevel, classcode } = exam

  const senDuration = Math.ceil(duration * 1.25)
  const modifiedExamDuration = classcode.match(/^\d{1}S(R|T)?$/)
    ? senDuration
    : duration

  const examInterval = Interval.after(
    DateTime.fromISO(startDateTime).minus(bufferDuration),
    Duration.fromObject({ minutes: modifiedExamDuration + 30 })
  )

  const orderedAvailableTeachers = _(teachers)
    .filter((t) => {
      const { teacher, isSkip, maxLoading, occurrence } = t
      if (maxLoading && maxLoading <= occurrence) return false
      if (isSkip != undefined) return false
      if (
        GENERAL_DUTIES.includes(classlevel) &&
        [...EXCLUSED_STANDBY_TEACHERS, ...DC_TEAM_MEMBERS].includes(teacher)
      )
        return false

      // Check teachers has assigned
      const isAssigned = _.some(assignedExaminiations, (assignedExam) => {
        const { invigilators, startDateTime, duration, classcode } =
          assignedExam
        if (!invigilators.includes(teacher)) return false
        const senDuration = Math.ceil(duration * 1.25)
        const modifiedExamDuration = classcode.match(/^\d{1}S(R|T)?$/)
          ? senDuration
          : duration

        const assignedExamInterval = Interval.after(
          DateTime.fromISO(startDateTime).minus(bufferDuration),
          Duration.fromObject({ minutes: modifiedExamDuration })
        )
        return examInterval.overlaps(assignedExamInterval)
      })

      // check if teachers in unavailableArrays
      const isUnavailable = _.some(unavailableArrays, (unavailable) => {
        // if the teacher has no information in unavailables
        const { teachers, slots } = unavailable

        if (!teachers.includes(teacher)) return false

        return _.some(slots, (slot) => {
          const { start, end } = slot
          const startDT = DateTime.fromISO(start).minus(bufferDuration)
          const endDT = DateTime.fromISO(end).plus(bufferDuration)

          const unavailableInterval = Interval.fromDateTimes(startDT, endDT)
          return examInterval.overlaps(unavailableInterval)
        })
      })

      return !(isUnavailable || isAssigned)
    })
    .value()

  if (GENERAL_DUTIES.includes(classlevel)) {
    return _.sortBy(orderedAvailableTeachers, [
      'generalDuty',
      'occurrence',
      'totalInvigilationTime',
      'coveringNumber'
    ])
  }
  return _.sortBy(orderedAvailableTeachers, [
    'coveringNumber',
    'totalInvigilationTime',
    'occurrence'
  ])
}

module.exports = {
  getOrderedAvailableTeachers,
  updateCoveringNumber,
  checkAssignedCrashWithUnavailable,
  GENERAL_DUTIES
}

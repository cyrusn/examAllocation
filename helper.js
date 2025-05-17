const _ = require('lodash')

const { DateTime, Duration, Interval } = require('luxon')

function updateCoveringNumber(list, teacher, duration) {
  const found = list.find((l) => l.teacher == teacher)
  const addedCoveringNumber = Math.max(
    0.5,
    Math.round((parseInt(duration) * 2) / 55) / 2
  )
  if (found) {
    found.coveringNumber += addedCoveringNumber
    found.net += addedCoveringNumber
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
  const { startDateTime, duration } = exam

  const examInterval = Interval.after(
    DateTime.fromISO(startDateTime).minus(bufferDuration),
    Duration.fromObject({ minutes: duration + 30 })
  )

  const orderedAvailableTeachers = _(teachers)
    .filter((t) => {
      const { teacher } = t

      // Check teachers has assigned
      const isAssigned = _.some(assignedExaminiations, (assignedExam) => {
        const { invigilators, startDateTime, duration } = assignedExam
        if (!invigilators.includes(teacher)) return false

        const assignedExamInterval = Interval.after(
          DateTime.fromISO(startDateTime).minus(bufferDuration),
          Duration.fromObject({ minutes: duration + 30 })
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
          // if (
          //   exam.title == '英國語文 試卷一 閱讀' &&
          //   exam.classlevel == 'S5' &&
          //   teacher == 'KKC'
          // ) {
          //   console.log(teacher, unavailableInterval, examInterval)
          // }
          return examInterval.overlaps(unavailableInterval)
        })
      })

      // if (
      //   exam.title == '英國語文 試卷一 閱讀' &&
      //   exam.classlevel == 'S5' &&
      //   teacher == 'KKC'
      // ) {
      //   console.log(teacher, isUnavailable, isAssigned)
      // }

      return !(isUnavailable || isAssigned)
    })
    .sortBy(['coveringNumber', 'asc'])
    .value()

  return orderedAvailableTeachers
}

module.exports = {
  getOrderedAvailableTeachers,
  updateCoveringNumber,
  checkAssignedCrashWithUnavailable
}

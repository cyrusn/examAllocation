const { DateTime, Duration, Interval } = require('luxon')
const {
  GENERAL_DUTIES,
  BUFFER_TIME,
  F6_BUFFER_TIME
} = require('./constants')

/**
 * Creates a Luxon Interval from a slot object.
 * @param {{start: string, end: string}} slot
 * @returns {Interval}
 */
function getIntervalBySlot(slot) {
  const { start, end } = slot
  const startDT = DateTime.fromISO(start)
  const endDT = DateTime.fromISO(end)

  return Interval.fromDateTimes(startDT, endDT)
}

/**
 * Calculates the duration for SEN (Special Educational Needs) exams.
 * @param {{title: string, duration: number}} exam
 * @returns {number}
 */
function getSenDuration(exam) {
  // Logic from original code:
  // return exam.title.toUpperCase().replace('.', '').includes('VA')
  //   ? Math.ceil(exam.duration * 1.05)
  //   : Math.ceil(exam.duration * 1.25)
  return Math.ceil(exam.duration * 1.25)
}

/**
 * Calculates the full time interval required for an exam, including buffer times.
 * @param {object} exam
 * @returns {Interval}
 */
function getExamInterval(exam) {
  const { startDateTime, duration, classcode, classlevel } = exam
  const examStartDateTime = DateTime.fromISO(startDateTime)
  const senDuration = getSenDuration(exam)
  
  // Determine if it uses SEN duration or normal duration based on classcode
  const isSen = /\d{1}S(R|T)?/.test(classcode)
  const examDuration = isSen ? senDuration : duration

  // Determine buffer time
  const isF6 = classcode && classcode.includes('6')
  const buffer = isF6 ? F6_BUFFER_TIME : BUFFER_TIME
  
  // Logic for General Duties vs Normal Exams seems identical in the original code regarding calculation
  // but explicitly separated.
  // Original:
  // if (GENERAL_DUTIES.includes(classlevel)) { ... same math ... }
  // return ... same math ...
  
  // We can simplify:
  const totalMinutes = examDuration + (buffer * 2)
  
  return Interval.after(
    examStartDateTime.minus({ minutes: buffer }),
    Duration.fromObject({ minutes: totalMinutes })
  )
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

const parseList = (str) => (str || '').replaceAll(/\n|\s|\r/g, '').split(',').filter(Boolean)

module.exports = {
  getIntervalBySlot,
  getSenDuration,
  getExamInterval,
  progressLog,
  parseList
}

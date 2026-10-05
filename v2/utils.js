const { DateTime, Duration, Interval } = require('luxon')
const {
  GENERAL_DUTIES,
  BUFFER_TIME,
  F6_BUFFER_TIME,
  TEACHER_ASSISTANTS
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
  return Math.ceil(exam.duration * 1.25)
}

/**
 * Returns the lead invigilator (PIC) from a list of invigilators.
 * Teacher assistants have lower priority.
 * @param {string[]} invigilators
 * @returns {string|null}
 */
function getPic(invigilators) {
  if (!invigilators || invigilators.length === 0) return null
  if (invigilators.length === 1) return invigilators[0]

  let picIndex = invigilators.findIndex(inv => !TEACHER_ASSISTANTS.includes(inv))
  if (picIndex === -1) {
    picIndex = 0
  }
  return invigilators[picIndex]
}

/**
 * Formats a list of invigilators, marking one with an asterisk if there are multiple.
 * Teacher assistants have lower priority for being the lead invigilator (*).
 * @param {string[]} invigilators
 * @returns {string}
 */
function formatInvigilators(invigilators) {
  if (!invigilators || invigilators.length === 0) return ''
  if (invigilators.length <= 1) return invigilators.join(', ')

  const pic = getPic(invigilators)
  const others = invigilators.filter(inv => inv !== pic)
  
  return [`*${pic}`, ...others].join(', ')
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
  if (process.stdout.isTTY) {
    process.stdout.clearLine()
    process.stdout.cursorTo(0)
    process.stdout.write(`Progress: ${result}`)
  }
  if (progress == 1 && process.stdout.isTTY) console.log()
}

const parseList = (str) => (str || '').toString().split(/,|\n/).map(s => s.trim()).filter(Boolean)

const parsePositionalList = (str) => {
  if (!str || !str.toString().trim()) return []
  return str.toString().split(/,|\n/).map(s => s.trim())
}

module.exports = {
  getIntervalBySlot,
  getSenDuration,
  getExamInterval,
  progressLog,
  parseList,
  parsePositionalList,
  formatInvigilators,
  getPic
}

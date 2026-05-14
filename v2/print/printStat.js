const _ = require('lodash')
const { calculateTeacherStats } = require('../logic')
const { getSheetData, appendRows, batchClearData, clearSheetFormatting, autoResizeRows, setWrapText } = require('../googleSheet')
const { F1_F5_EXAM_PERIOD, F6_EXAM_PERIOD } = require('../constants')
const { Interval, DateTime } = require('luxon')
const { getIntervalBySlot } = require('../utils')

async function printStat(assignedExaminations, unavailableArrays = []) {
  const SPREADSHEET_ID = process.env['SPREADSHEET_ID']
  await batchClearData(SPREADSHEET_ID, 'stat!A:Z')
  await clearSheetFormatting(SPREADSHEET_ID, 'stat')
  await setWrapText(SPREADSHEET_ID, 'stat')

  const rawTeachers = await getSheetData(SPREADSHEET_ID, 'teachers!A:E')
  
  // Define full exam ranges
  const f1f5Period = Interval.fromISO(F1_F5_EXAM_PERIOD)
  const f6Period = Interval.fromISO(F6_EXAM_PERIOD)

  // Initial mapping
  let teachers = rawTeachers.map((t) => {
    const teacherId = (t.teacher || '').trim()
    
    // Calculate total lessons in the entire exam period
    const teacherLessons = unavailableArrays.filter(u => {
      const matchTeacher = u.teachers.some(initial => initial.trim() === teacherId)
      const isLesson = /[Dd]\s*\d+\s*[Pp]\s*\d+/.test(u.remark || '')
      return matchTeacher && isLesson
    })

    let periodLessons = 0
    teacherLessons.forEach(u => {
      u.slots.forEach(slot => {
        const slotStart = DateTime.fromISO(slot.start)
        if (!slotStart.isValid) return

        // Check if the lesson date falls within either exam period
        const isF1F5 = slotStart >= f1f5Period.start && slotStart <= f1f5Period.end
        const isF6 = slotStart >= f6Period.start && slotStart <= f6Period.end
        
        if (isF1F5 || isF6) {
          periodLessons++
        }
      })
    })

    return {
      ...t,
      teacher: teacherId,
      originalSubstitutionNumber: parseInt(t.substitutionNumber) || 0,
      totalInvigilationTime: 0,
      fiDuty: 0,
      sbDuty: 0,
      guidanceDuty: 0,
      occurrence: 0,
      periodLessons
    }
  })

  // Calculate stats using pure logic
  teachers = calculateTeacherStats(teachers, assignedExaminations)

  console.log('Printing Statistic')
  const rows = teachers.reduce((prev, t, idx) => {
    const {
      teacher,
      originalSubstitutionNumber,
      totalInvigilationTime,
      occurrence,
      fiDuty,
      sbDuty,
      guidanceDuty,
      senDuty,
      isSkip,
      periodLessons
    } = t
    if (idx == 0) {
      prev.push([
        'teacher',
        'originalSubstitutionNumber',
        'assignedPeriods',
        'Balance (Net)',
        'Period Lessons',
        'totalInvigilationTime',
        'occurrence',
        'fiDuty',
        'sbDuty',
        'guidanceDuty',
        'senDuty',
        'isSkip'
      ])
    }
    const assignedPeriods = Math.round((totalInvigilationTime + 15) / 55)
    prev.push([
      teacher,
      originalSubstitutionNumber,
      assignedPeriods,
      originalSubstitutionNumber + assignedPeriods,
      periodLessons,
      totalInvigilationTime,
      occurrence,
      fiDuty || 0,
      sbDuty || 0,
      guidanceDuty || 0,
      senDuty || 0,
      isSkip
    ])
    return prev
  }, [])

  // Separate header from data to prevent sorting the header row
  const header = rows[0]
  const data = rows.slice(1)
  
  // Sort data by 'totalInvigilationTime' (index 5) descending
  const sortedData = _.orderBy(data, [5], ['desc'])
  
  // Recombine header and sorted data
  const finalRows = [header, ...sortedData]

  await appendRows(SPREADSHEET_ID, 'stat!A:A', finalRows)
  await autoResizeRows(SPREADSHEET_ID, 'stat')
}

module.exports = { printStat }

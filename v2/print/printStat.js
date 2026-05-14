const _ = require('lodash')
const { calculateTeacherStats } = require('../logic')
const { getSheetData, appendRows, batchClearData, clearSheetFormatting, autoResizeRows, setWrapText } = require('../googleSheet')
const { F1_F5_EXAM_PERIOD, F6_EXAM_PERIOD } = require('../constants')
const { Interval } = require('luxon')
const { getIntervalBySlot } = require('../utils')

async function printStat(assignedExaminations, unavailableArrays = []) {
  const SPREADSHEET_ID = process.env['SPREADSHEET_ID']
  await batchClearData(SPREADSHEET_ID, 'stat!A:Z')
  await clearSheetFormatting(SPREADSHEET_ID, 'stat')
  await setWrapText(SPREADSHEET_ID, 'stat')

  const rawTeachers = await getSheetData(SPREADSHEET_ID, 'teachers!A:E')
  
  // Define full exam range
  const fullPeriod = Interval.fromISO(F1_F5_EXAM_PERIOD).union(Interval.fromISO(F6_EXAM_PERIOD))

  // Initial mapping
  let teachers = rawTeachers.map((t) => {
    // Calculate total lessons in the entire exam period
    const teacherLessons = unavailableArrays.filter(u => 
      u.teachers.includes(t.teacher) && /D\dP\d/.test(u.remark)
    )
    let periodLessons = 0
    teacherLessons.forEach(u => {
      u.slots.forEach(slot => {
        if (fullPeriod.overlaps(getIntervalBySlot(slot))) {
          periodLessons++
        }
      })
    })

    return {
      ...t,
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
  
  // Sort data by 'totalInvigilationTime' (index 4) descending
  const sortedData = _.orderBy(data, [4], ['desc'])
  
  // Recombine header and sorted data
  const finalRows = [header, ...sortedData]

  await appendRows(SPREADSHEET_ID, 'stat!A:A', finalRows)
  await autoResizeRows(SPREADSHEET_ID, 'stat')
}

module.exports = { printStat }

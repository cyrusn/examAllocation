const _ = require('lodash')
const { calculateTeacherStats } = require('../logic')
const { getSheetData, appendRows, batchClearData, clearSheetFormatting, autoResizeRows, setWrapText } = require('../googleSheet')

async function printStat(assignedExaminations) {
  const SPREADSHEET_ID = process.env['SPREADSHEET_ID']
  await batchClearData(SPREADSHEET_ID, 'stat!A:Z')
  await clearSheetFormatting(SPREADSHEET_ID, 'stat')
  await setWrapText(SPREADSHEET_ID, 'stat')

  const rawTeachers = await getSheetData(SPREADSHEET_ID, 'teachers!A:D')
  // Initial mapping
  let teachers = rawTeachers.map((t) => {
    return {
      ...t,
      originalSubstitutionNumber: parseInt(t.substitutionNumber) || 0,
      totalInvigilationTime: 0,
      generalDuty: 0,
      occurrence: 0
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
      generalDuty,
      senDuty,
      isSkip
    } = t
    if (idx == 0) {
      prev.push([
        'teacher',
        'originalSubstitutionNumber',
        'substitutionNumber',
        'totalInvigilationTime',
        'occurrence',
        'generalDuty',
        'senDuty',
        'isSkip'
      ])
    }
    prev.push([
      teacher,
      originalSubstitutionNumber,
      Math.round((totalInvigilationTime + 15) / 55),
      totalInvigilationTime,
      occurrence,
      generalDuty || 0,
      senDuty || 0,
      isSkip
    ])
    return prev
  }, [])

  await appendRows(SPREADSHEET_ID, 'stat!A:A', _.orderBy(rows, [3], ['desc']))
  await autoResizeRows(SPREADSHEET_ID, 'stat')
}

module.exports = { printStat }

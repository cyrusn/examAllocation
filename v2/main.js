require('dotenv').config()
const _ = require('lodash')
const fs = require('fs')
const {
  validateAssignments,
  validateCollisions,
  sanitizeCollisions
} = require('./logic')
const {
  printView,
  printStat,
  printSen,
  printTeacherView
} = require('./print')
const { getSheetData } = require('./googleSheet')
const { allocateExaminations } = require('./allocator')
const { parseTeachers, parseUnavailables, parseExaminations } = require('./parser')
const { OUTPUT_FILE_PATH } = require('./constants')

const main = async () => {
  console.log('Allocating Examinations (v2)...')
  console.time('Time to finish')
  
  const SPREADSHEET_ID = process.env['SPREADSHEET_ID']

  // 1. Fetch Data
  const [ 
    rawExaminations,
    rawUnavailables,
    ignoredSlots,
    rawTeachers
  ] = await Promise.all([
    getSheetData(SPREADSHEET_ID, 'exam!A:O'),
    getSheetData(SPREADSHEET_ID, 'unavailables!A:C'),
    getSheetData(SPREADSHEET_ID, 'ignoredUnavailables!A:D'),
    getSheetData(SPREADSHEET_ID, 'teachers!A:D')
  ])

  // 2. Prepare Data
  let teachers = parseTeachers(rawTeachers)
  const unavailableArrays = parseUnavailables(rawUnavailables)
  const examinations = parseExaminations(rawExaminations)

  // 3. Initialize Assignments & Sanitize Pre-assignments
  let assignedExaminations = sanitizeCollisions(examinations)
  
  // 4. Run Allocation (Core Logic)
  assignedExaminations = allocateExaminations(examinations, teachers, unavailableArrays)

  console.log(`\n${assignedExaminations.length} examinations are assigned.`) // Added escape for 

  // 5. Sort and Validate
  const finalAssignedExaminations = _.sortBy(assignedExaminations, [
    'startDateTime',
    'classlevel',
    'classcode'
  ])

  // Validation Checks
  const crashes = validateAssignments(finalAssignedExaminations, unavailableArrays, ignoredSlots)
  if (crashes.length > 0) {
    console.error('Validation Failed: Assignments crash with availability.')
    crashes.forEach(c => {
       console.log(`${c.exam.id} ${c.exam.title}: ${c.invigilator} unavailable at ${c.slot.start}-${c.slot.end} (${c.remark})`)
    })
  } else {
    console.log('Availability Validation Passed.')
  }

  const collisions = validateCollisions(finalAssignedExaminations)
  if (collisions.length > 0) {
    console.error('Validation Failed: Invigilator Collisions Detected.')
    collisions.forEach(c => {
      console.log(`Collision: [${c.teachers.join(', ')}] in ${c.examA.id} (${c.examA.title}) and ${c.examB.id} (${c.examB.title})`)
    })
  } else {
    console.log('Collision Validation Passed.')
  }

  // 6. Output
  if (!fs.existsSync(OUTPUT_FILE_PATH)) {
    fs.mkdirSync(OUTPUT_FILE_PATH, { recursive: true })
  }
  
  fs.writeFileSync(
    OUTPUT_FILE_PATH + '/result.json',
    JSON.stringify(finalAssignedExaminations, null, 2),
    'utf8'
  )

  await printStat(finalAssignedExaminations)
  await printView(finalAssignedExaminations)
  await printSen(finalAssignedExaminations)
  await printTeacherView(finalAssignedExaminations)

  console.timeEnd('Time to finish')
}

main().catch(console.error)

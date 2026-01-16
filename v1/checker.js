const { printView, printTeacherView, printStat } = require('./printHelper')

const assignedExaminations = require('./out/result.json')
// finalCheck(assignedExaminations)
printTeacherView(assignedExaminations)
// printView(assignedExaminations)
// printStat(assignedExaminations)

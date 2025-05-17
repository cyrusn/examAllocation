const list = [1, 2, 3]
const result = list.reduce((prev, cur, idx, list) => {
  prev.push('a')
  list.push('a')
  console.log(list)
  return prev
}, [])

console.log(result)

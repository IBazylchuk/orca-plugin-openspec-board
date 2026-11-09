import { assert, test } from 'orca/testing'
import { applyText } from './apply'

const ticket = { key: 'PROJ-7', url: null }

test('fills the change and the ticket into the command', () => {
  assert.deepEqual(applyText('/opsx:apply {change}', 'add-dark-mode', null), { text: '/opsx:apply add-dark-mode' })
  assert.deepEqual(applyText('/work {ticket}', 'proj-7-dark-mode', ticket), { text: '/work PROJ-7' })
})

test('a command that needs a ticket refuses a change without one', () => {
  assert.ok('refused' in applyText('/work {ticket}', 'add-dark-mode', null))
})

test('a change name with a control character is never typed', () => {
  for (const name of ['x\r!rm -rf ~', 'x\nsecond line', 'x\u001b[2J', `x${String.fromCharCode(0x2028)}y`]) {
    assert.ok('refused' in applyText('/opsx:apply {change}', name, null), JSON.stringify(name))
  }
})

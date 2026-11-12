import { assert, test } from 'orca/testing'
import { diskIo } from './disk-io'

test('a command that outlives its own timeout answers null, a quick one answers its output', async () => {
  assert.equal(await diskIo.run('sleep', ['5'], 50), null)
  assert.equal(await diskIo.run('echo', ['done'], 5000), 'done\n')
})

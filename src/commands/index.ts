// Every command module, imported for its definitions.
import './app'
import './local'
import './stations'

export { cmd, commandScope, run, type CommandId } from './registry'
export { installCommandDispatch } from './dispatch'

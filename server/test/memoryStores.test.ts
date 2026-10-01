import { runStoreContract } from './storeContract'
import { createMemoryStores } from '../src/memoryStores'

runStoreContract('memory', () => createMemoryStores())

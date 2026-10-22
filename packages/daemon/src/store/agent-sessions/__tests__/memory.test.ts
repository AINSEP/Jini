import {sessionContract} from './contract.js';
import {createInMemoryAgentSessionStore} from '../index.js';
sessionContract(async()=>({store:createInMemoryAgentSessionStore({  }),close:async()=>{}}));

import { createApi, type Transport } from '@workspace/core'
import api from './api'

/** Web transport: reuses the axios instance (bearer + cookie refresh + 401 handling). */
const transport: Transport = {
  async request(method, path, o = {}) {
    const res = await api.request({
      method, url: path, params: o.params, data: o.form ?? o.body,
      responseType: o.responseType === 'blob' ? 'blob' : 'json',
    })
    return res.data
  },
}

export const coreApi = createApi(transport)

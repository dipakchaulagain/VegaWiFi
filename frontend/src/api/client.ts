import axios from 'axios'

const client = axios.create({
  baseURL: '/api/v1',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
})

client.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.response?.status === 401) {
      const current = window.location.pathname
      if (current !== '/login' && current !== '/setup') {
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  }
)

export default client

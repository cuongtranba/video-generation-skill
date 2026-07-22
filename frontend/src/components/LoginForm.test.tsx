import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useVidgenStore } from '../store/store'
import { LoginForm } from './LoginForm'

const realLogin = useVidgenStore.getState().login

beforeEach(() => {
  useVidgenStore.setState({ auth: 'anonymous' })
})
afterEach(() => {
  useVidgenStore.setState({ login: realLogin })
})

describe('LoginForm', () => {
  it('renders the credential fields and the sign-in action', () => {
    render(<LoginForm />)
    expect(screen.getByLabelText(/tên đăng nhập/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/mật khẩu/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /đăng nhập/i })).toBeInTheDocument()
  })

  it('calls login with the entered credentials on submit', async () => {
    const loginMock = mock(async () => true)
    useVidgenStore.setState({ login: loginMock as unknown as typeof realLogin })
    render(<LoginForm />)

    fireEvent.change(screen.getByLabelText(/tên đăng nhập/i), { target: { value: 'admin' } })
    fireEvent.change(screen.getByLabelText(/mật khẩu/i), { target: { value: 's3cret' } })
    fireEvent.click(screen.getByRole('button', { name: /đăng nhập/i }))

    await waitFor(() => expect(loginMock).toHaveBeenCalledTimes(1))
    expect(loginMock).toHaveBeenCalledWith('admin', 's3cret')
  })

  it('shows an error alert when login fails', async () => {
    const loginMock = mock(async () => false)
    useVidgenStore.setState({ login: loginMock as unknown as typeof realLogin })
    render(<LoginForm />)

    fireEvent.change(screen.getByLabelText(/tên đăng nhập/i), { target: { value: 'admin' } })
    fireEvent.change(screen.getByLabelText(/mật khẩu/i), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: /đăng nhập/i }))

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent(/sai tên đăng nhập/i)
  })
})

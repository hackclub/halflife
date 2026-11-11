import { Component, type ReactNode } from 'react'
import { Failure } from './parts'
import { readableError } from '../core/workers'

export default class ErrorBoundary extends Component<
  { children: ReactNode; resetKey: string },
  { error: string | null }
> {
  state = { error: null as string | null }

  static getDerivedStateFromError(error: unknown) {
    return { error: readableError(error) }
  }

  componentDidUpdate(previous: { resetKey: string }) {
    if (previous.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }

  render() {
    return this.state.error ? <Failure message={`This viewer crashed: ${this.state.error}`} /> : this.props.children
  }
}

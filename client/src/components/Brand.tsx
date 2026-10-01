import { Link } from 'react-router-dom'

export function Brand() {
  return (
    <Link className="brand" to="/" aria-label="Unison home">
      <img src="/logo-mark.svg" alt="" />
      <span>unison</span>
    </Link>
  )
}

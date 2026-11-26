import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-gray-300">404</h1>
        <p className="text-xl text-gray-600 mt-4">Page not found</p>
        <p className="text-sm text-gray-500 mt-2">The page you're looking for doesn't exist.</p>
        <Link to="/dashboard" className="inline-block mt-6">
          <Button>Go to Dashboard</Button>
        </Link>
      </div>
    </div>
  )
}

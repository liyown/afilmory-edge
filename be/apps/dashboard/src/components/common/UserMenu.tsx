import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@afilmory/ui'
import { clsxm } from '@afilmory/utils'
import { LogOut, Settings, User as UserIcon } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'

import { usePageRedirect } from '~/hooks/usePageRedirect'
import type { BetterAuthUser } from '~/modules/auth/types'

interface UserMenuProps {
  user: BetterAuthUser
}

export function UserMenu({ user }: UserMenuProps) {
  const { logout } = usePageRedirect()
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [isOpen, setIsOpen] = useState(false)

  const handleLogout = async () => {
    if (isLoggingOut) {
      return
    }

    setIsLoggingOut(true)
    try {
      await logout()
    }
    catch (error) {
      console.error('Logout failed:', error)
      setIsLoggingOut(false)
    }
  }

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={clsxm(
            'flex items-center gap-2.5 rounded-lg px-2 py-1.5',
            'transition-all duration-200',
            'hover:bg-fill/50',
            'active:scale-[0.98]',
            'focus:outline-none focus:ring-2 focus:ring-accent/40',
          )}
        >
          {/* User Avatar */}
          <div className="relative">
            {user.image ? (
              <img src={user.image} alt={user.name || user.email} className="size-7 rounded-full object-cover" />
            ) : (
              <div className="bg-accent/20 text-accent flex size-7 items-center justify-center rounded-full text-xs font-medium">
                {(user.name || user.email).charAt(0).toUpperCase()}
              </div>
            )}
          </div>

          {/* User Info - Hidden on small screens */}
          <div className="hidden text-left md:block">
            <div className="text-text text-sm leading-tight font-medium">{user.name || user.email}</div>
            <div className="text-text-tertiary text-[10px] leading-tight capitalize">{user.role}</div>
          </div>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        className="border-fill-tertiary bg-background w-56 shadow-lg"
        style={{
          backgroundImage: 'none',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
        }}
      >
        <DropdownMenuLabel>
          <div className="flex flex-col space-y-1">
            <p className="text-text text-sm font-medium">{user.name || 'User'}</p>
            <p className="text-text-tertiary text-xs">{user.email}</p>
          </div>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuItem icon={<UserIcon className="size-4" />}>
          <Link to="/settings/account">Account Settings</Link>
        </DropdownMenuItem>

        <DropdownMenuItem icon={<Settings className="size-4" />}>
          <Link to="/settings/site">Preferences</Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={handleLogout} disabled={isLoggingOut} icon={<LogOut className="text-red size-4" />}>
          <span className="text-red">{isLoggingOut ? 'Logging out...' : 'Log out'}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

'use client'

export default function Home() {
  return (
    <iframe
      src="/pythagoras/index.html"
      title="Pythagoras Platform"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        border: 'none',
        margin: 0,
        padding: 0,
        display: 'block',
      }}
      allow="fullscreen"
    />
  )
}

import { NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import path from 'path'

export async function GET() {
  try {
    const filePath = path.join(process.cwd(), 'public', 'pythagoras', 'index.html')
    let html = await readFile(filePath, 'utf-8')
    // Rewrite relative paths to point to /pythagoras/
    html = html.replace(/\.\/src\//g, '/pythagoras/src/')
    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, must-revalidate',
      },
    })
  } catch (e) {
    return NextResponse.json({ error: 'Failed to load Pythagoras app' }, { status: 500 })
  }
}

package com.p2pdrop

import android.app.Application

class P2PDropApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        instance = this
    }

    companion object {
        lateinit var instance: P2PDropApplication
            private set
    }
}

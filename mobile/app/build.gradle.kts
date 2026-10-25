plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.dilkhushraita.dashboard"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.dilkhushraita.dashboard"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            // Nothing here is secret and the app is handed out as a file, so
            // shrinking buys a smaller download and nothing else. Off, because
            // a stripped stack trace is a bad trade when the person debugging
            // it is reading it over WhatsApp.
            isMinifyEnabled = false
            // Signed with the debug key: this is sideloaded onto phones the
            // owner controls, never submitted to a store. A release build that
            // cannot be installed would be worse than an honestly-signed one.
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { viewBinding = false }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
}

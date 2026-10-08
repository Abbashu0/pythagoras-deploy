require 'json'
package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name = 'PythagorasChatPreview'
  s.version = package['version']
  s.summary = package['description']
  s.description = package['description']
  s.license = { :type => 'Proprietary' }
  s.author = 'Pythagoras'
  s.homepage = 'https://github.com/Abbashu0/pythagoras-deploy'
  s.source = { :git => 'https://github.com/Abbashu0/pythagoras-deploy.git' }
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.dependency 'ExpoUI'
  s.frameworks = 'UIKit', 'SwiftUI'
  s.source_files = '*.swift'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end

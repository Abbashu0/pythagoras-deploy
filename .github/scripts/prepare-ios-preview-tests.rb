#!/usr/bin/env ruby
# Only generated mobile/ios artifacts are edited. Never changes app.json,
# production Swift sources, podspecs, or the production app target's settings.
require 'json'
require 'pathname'
require 'xcodeproj'

root = File.realpath(File.join(__dir__, '../..'))
ios = File.join(root, 'mobile/ios')
paths = Dir.glob(File.join(ios, '*.xcodeproj'))
abort 'Expected one actual Expo-generated Xcode project; run prebuild on macOS first' unless paths.length == 1
podfile = File.join(ios, 'Podfile')
abort 'Generated Podfile is missing' unless File.file?(podfile)
project = Xcodeproj::Project.open(paths.first)
app = project.targets.select do |target|
  target.product_type == 'com.apple.product-type.application' &&
    target.build_configurations.all? { |c| c.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] == 'com.abbashu.pythagoras' }
end
abort 'Expected exactly one production com.abbashu.pythagoras target' unless app.length == 1
names = %w[PythagorasPreviewTestHost PythagorasPreviewTests]
abort 'Test targets already exist; use a fresh generated project' if project.targets.any? { |t| names.include?(t.name) }
abort 'Test Podfile block already exists; refusing duplicate wiring' if File.read(podfile).include?('# BEGIN PYTHAGORAS PREVIEW TESTS')

snapshot = lambda do |target|
  { 'target' => target.to_hash,
    'configs' => target.build_configurations.map(&:to_hash),
    'phases' => target.build_phases.map(&:to_hash) }
end
original = Marshal.load(Marshal.dump(snapshot.call(app.first)))
properties = JSON.parse(File.read(File.join(ios, 'Podfile.properties.json')))
deployment = properties.fetch('ios.deploymentTarget', '16.4')
host = project.new_target(:application, names[0], :ios, deployment)
tests = project.new_target(:unit_test_bundle, names[1], :ios, deployment)
tests.add_dependency(host)
project.root_object.attributes['TargetAttributes'] ||= {}
project.root_object.attributes['TargetAttributes'][tests.uuid] = { 'TestTargetID' => host.uuid }

module_root = File.join(root, 'mobile/modules/pythagoras-chat-preview')
%w[ios-tests/host/PreviewTestHost.swift ios-tests/host/Info.plist ios-tests/NativePreviewLayoutTests.swift].each do |relative|
  abort "Missing test source: #{relative}" unless File.file?(File.join(module_root, relative))
end
group = project.main_group.new_group('Pythagoras native preview tests')
host_source = group.new_file(File.join(module_root, 'ios-tests/host/PreviewTestHost.swift'))
suite_source = group.new_file(File.join(module_root, 'ios-tests/NativePreviewLayoutTests.swift'))
host.source_build_phase.add_file_reference(host_source)
tests.source_build_phase.add_file_reference(suite_source)

[host, tests].each do |target|
  target.build_configurations.each do |config|
    config.build_settings.merge!(
      'SDKROOT' => 'iphonesimulator', 'SUPPORTED_PLATFORMS' => 'iphonesimulator',
      'TARGETED_DEVICE_FAMILY' => '1', 'SWIFT_VERSION' => '5.9',
      'PRODUCT_NAME' => target.name,
      'CODE_SIGNING_ALLOWED' => 'NO', 'CODE_SIGNING_REQUIRED' => 'NO',
      'LD_RUNPATH_SEARCH_PATHS' => '$(inherited) @executable_path/Frameworks @loader_path/Frameworks'
    )
    if config.name == 'Debug'
      config.build_settings['ENABLE_TESTABILITY'] = 'YES'
      config.build_settings['SWIFT_ACTIVE_COMPILATION_CONDITIONS'] = '$(inherited) DEBUG'
      config.build_settings['SWIFT_OPTIMIZATION_LEVEL'] = '-Onone'
    end
  end
end
host.build_configurations.each do |config|
  config.build_settings.merge!(
    'PRODUCT_BUNDLE_IDENTIFIER' => 'com.abbashu.pythagoras.preview-test-host',
    'INFOPLIST_FILE' => File.join(module_root, 'ios-tests/host/Info.plist'),
    'GENERATE_INFOPLIST_FILE' => 'NO', 'DEAD_CODE_STRIPPING' => 'NO'
  )
end
tests.build_configurations.each do |config|
  config.build_settings.merge!(
    'PRODUCT_BUNDLE_IDENTIFIER' => 'com.abbashu.pythagoras.preview-test-suite',
    'GENERATE_INFOPLIST_FILE' => 'YES',
    'FRAMEWORK_SEARCH_PATHS' => ['$(inherited)', '$(PLATFORM_DIR)/Developer/Library/Frameworks'],
    'TEST_HOST' => '$(BUILT_PRODUCTS_DIR)/PythagorasPreviewTestHost.app/PythagorasPreviewTestHost',
    'BUNDLE_LOADER' => '$(TEST_HOST)'
  )
end
abort 'Production target changed during test preparation' unless snapshot.call(app.first) == original
project.save
reloaded = Xcodeproj::Project.open(paths.first).targets.find { |t| t.uuid == app.first.uuid }
abort 'Production target changed after serialization' unless snapshot.call(reloaded) == original

scheme = Xcodeproj::XCScheme.new
scheme.configure_with_targets(host, tests, launch_target: true)
scheme.test_action.build_configuration = 'Debug'
scheme.launch_action.build_configuration = 'Debug'
scheme.build_action.entries.each do |entry|
  entry.build_for_archiving = false
  entry.build_for_profiling = false
end
scheme.save_as(paths.first, names[1], true)

# The sibling host uses the same installed pod and framework linkage. The test
# bundle inherits search paths and loads that module from TEST_HOST, not a copied
# set of production Swift files. Existing Expo/RN post_install remains intact.
File.open(podfile, 'a') do |file|
  file.write <<~RUBY

    # BEGIN PYTHAGORAS PREVIEW TESTS
    target 'PythagorasPreviewTestHost' do
      use_frameworks! :linkage => podfile_properties['ios.useFrameworks'].to_sym if podfile_properties['ios.useFrameworks']
      use_frameworks! :linkage => ENV['USE_FRAMEWORKS'].to_sym if ENV['USE_FRAMEWORKS']
      pod 'PythagorasChatPreview', :path => '../modules/pythagoras-chat-preview/ios'
      target 'PythagorasPreviewTests' do
        inherit! :search_paths
      end
    end
    # END PYTHAGORAS PREVIEW TESTS
  RUBY
end
puts JSON.pretty_generate(project: paths.first, scheme: names[1], host: names[0],
  production_bundle_id: 'com.abbashu.pythagoras', production_target_preserved: true,
  framework_linkage: properties['ios.useFrameworks'], hosted_source: suite_source.real_path.to_s)

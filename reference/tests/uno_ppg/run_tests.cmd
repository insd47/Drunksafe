@echo off
setlocal
for /f "usebackq tokens=*" %%i in (`"%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "PPG_TEST_VS=%%i"
if not defined PPG_TEST_VS exit /b 1
call "%PPG_TEST_VS%\VC\Auxiliary\Build\vcvars64.bat" >nul
if errorlevel 1 exit /b 1
pushd "%~dp0"
cl /nologo /std:c++14 /EHsc /W4 /I. test.cpp /Febutterworth_tests.exe /Fobutterworth_tests.obj
if errorlevel 1 exit /b 1
butterworth_tests.exe
if errorlevel 1 exit /b 1
cl /nologo /std:c++14 /EHsc /W4 /I. /DTEST_EMA test.cpp /Feema_tests.exe /Foema_tests.obj
if errorlevel 1 exit /b 1
ema_tests.exe
if errorlevel 1 exit /b 1
popd
endlocal

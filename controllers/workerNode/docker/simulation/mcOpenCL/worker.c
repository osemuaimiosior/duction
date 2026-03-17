#include <stdio.h>
#include <stdlib.h>

#ifdef __APPLE__
#include <OpenCL/opencl.h>
#else
#include <CL/cl.h>
#endif

#define MAX_SOURCE_SIZE 0x100000

int main(int argc, char *argv[])
{
    if (argc < 7) {
        printf("Usage: ./mc runs S0 K r sigma T\n");
        return 1;
    }

    int runs = atoi(argv[1]);
    float S0 = atof(argv[2]);
    float K = atof(argv[3]);
    float r = atof(argv[4]);
    float sigma = atof(argv[5]);
    float T = atof(argv[6]);

    cl_device_id device_id;
    cl_context context;
    cl_command_queue command_queue;
    cl_mem memobj;
    cl_program program;
    cl_kernel kernel;
    cl_platform_id platform_id;
    cl_uint ret_num_devices;
    cl_uint ret_num_platforms;
    cl_int ret;

    FILE *fp;
    char fileName[] = "./kernel.cl";
    char *source_str;
    size_t source_size;

    /* Load kernel source */
    fp = fopen(fileName, "r");
    if (!fp) {
        printf("Failed to load kernel.\n");
        exit(1);
    }

    source_str = (char *)malloc(MAX_SOURCE_SIZE);
    source_size = fread(source_str, 1, MAX_SOURCE_SIZE, fp);
    fclose(fp);

    /* Platform + Device */
    clGetPlatformIDs(1, &platform_id, &ret_num_platforms);
    clGetDeviceIDs(platform_id, CL_DEVICE_TYPE_GPU, 1, &device_id, &ret_num_devices);

    /* Context */
    context = clCreateContext(NULL, 1, &device_id, NULL, NULL, &ret);

    /* Command queue */
    command_queue = clCreateCommandQueue(context, device_id, 0, &ret);

    /* Memory buffer for results */
    memobj = clCreateBuffer(context, CL_MEM_WRITE_ONLY, runs * sizeof(float), NULL, &ret);

    /* Program */
    program = clCreateProgramWithSource(context, 1,
                                        (const char **)&source_str,
                                        &source_size, &ret);

    clBuildProgram(program, 1, &device_id, NULL, NULL, NULL);

    /* Kernel */
    kernel = clCreateKernel(program, "monteCarloOption", &ret);

    /* Set kernel arguments */
    clSetKernelArg(kernel, 0, sizeof(float), &S0);
    clSetKernelArg(kernel, 1, sizeof(float), &K);
    clSetKernelArg(kernel, 2, sizeof(float), &r);
    clSetKernelArg(kernel, 3, sizeof(float), &sigma);
    clSetKernelArg(kernel, 4, sizeof(float), &T);
    clSetKernelArg(kernel, 5, sizeof(int), &runs);
    clSetKernelArg(kernel, 6, sizeof(cl_mem), &memobj);

    /* Run kernel */
    size_t global_size = runs;

    clEnqueueNDRangeKernel(
        command_queue,
        kernel,
        1,
        NULL,
        &global_size,
        NULL,
        0,
        NULL,
        NULL
    );

    /* Read results */
    float *results = (float*)malloc(sizeof(float) * runs);

    clEnqueueReadBuffer(
        command_queue,
        memobj,
        CL_TRUE,
        0,
        runs * sizeof(float),
        results,
        0,
        NULL,
        NULL
    );

    /* Compute average option price */
    double sum = 0;

    for(int i = 0; i < runs; i++)
        sum += results[i];

    printf("Option Price = %f\n", sum / runs);

    /* Cleanup */
    clFlush(command_queue);
    clFinish(command_queue);

    clReleaseKernel(kernel);
    clReleaseProgram(program);
    clReleaseMemObject(memobj);
    clReleaseCommandQueue(command_queue);
    clReleaseContext(context);

    free(source_str);
    free(results);

    return 0;
}